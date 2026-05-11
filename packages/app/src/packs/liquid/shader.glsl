// Liquid sloshing in a rocking glass tumbler.
// SDF ray marching for the glass, gravity-anchored liquid surface inside.

#define PI  3.14159265359
#define TAU 6.28318530718
#define MAX_STEPS 90
#define MAX_DIST  6.0
#define SURF_DIST 0.0008

// ─── rotation ──────────────────────────────────────────────────────────

mat3 rotX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0,  0.0, c, -s,  0.0, s, c);
}
mat3 rotZ(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, -s, 0.0,  s, c, 0.0,  0.0, 0.0, 1.0);
}

// ─── SDF primitives ────────────────────────────────────────────────────

float sdRoundedCylinder(vec3 p, float ra, float rb, float h) {
    vec2 d = vec2(length(p.xz) - ra + rb, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - rb;
}

float sdGlass(vec3 p, float outerR, float height, float wall, float rnd) {
    float outer = sdRoundedCylinder(p, outerR, rnd, height);
    vec3 pi = p; pi.y -= wall * 0.5;
    float inner = sdRoundedCylinder(pi, outerR - wall, rnd * 0.5, height - wall * 0.5);
    return max(outer, -inner);
}

float sdInterior(vec3 p, float outerR, float height, float wall, float rnd) {
    vec3 pi = p; pi.y -= wall * 0.5;
    return sdRoundedCylinder(pi, outerR - wall, rnd * 0.5, height - wall * 0.5);
}

float sdOuterOnly(vec3 p, float outerR, float height, float rnd) {
    return sdRoundedCylinder(p, outerR, rnd, height);
}

// ─── liquid surface (world space, gravity = -Y) ───────────────────────

float liquidSurface(vec2 xz, float baseH, float rockAngle, float rockPhase,
                    float agitation, float visc, float t) {
    float damp = mix(1.0, 0.2, visc);
    float h = baseH;

    float slosh = rockAngle * 1.4 * damp;
    h -= slosh * (cos(rockPhase) * xz.x + sin(rockPhase) * xz.y);

    float dist = length(xz);

    float w1 = sin(xz.x * 3.0 + t * 0.5 * damp) *
               cos(xz.y * 2.5 + t * 0.4 * damp) * 0.035;
    float w2 = sin(xz.x * 6.5 - t * 0.8 * damp + xz.y * 4.5) * 0.012;
    float w3 = sin(dist * 9.0 - t * 0.9 * damp) * 0.008;
    float w4 = sin(dist * 5.0 - t * 1.4) * agitation * 0.05 * damp;

    h += (w1 + w2 + w3 + w4) * (0.2 + agitation * 0.8);

    return h;
}

vec3 liquidNormal(vec2 xz, float baseH, float rockAngle, float rockPhase,
                  float agitation, float visc, float t) {
    float e = 0.004;
    float hc = liquidSurface(xz, baseH, rockAngle, rockPhase, agitation, visc, t);
    float hx = liquidSurface(xz + vec2(e, 0.0), baseH, rockAngle, rockPhase, agitation, visc, t);
    float hz = liquidSurface(xz + vec2(0.0, e), baseH, rockAngle, rockPhase, agitation, visc, t);
    return normalize(vec3(hc - hx, e, hc - hz));
}

// ─── SDF normal ────────────────────────────────────────────────────────

vec3 calcNormal(vec3 p, float oR, float h, float w, float r) {
    vec2 e = vec2(0.0008, 0.0);
    return normalize(vec3(
        sdGlass(p + e.xyy, oR, h, w, r) - sdGlass(p - e.xyy, oR, h, w, r),
        sdGlass(p + e.yxy, oR, h, w, r) - sdGlass(p - e.yxy, oR, h, w, r),
        sdGlass(p + e.yyx, oR, h, w, r) - sdGlass(p - e.yyx, oR, h, w, r)
    ));
}

// ─── environment / background ──────────────────────────────────────────

vec3 envMap(vec3 dir, float t) {
    // gradient sky dome with subtle color bands
    float y = dir.y * 0.5 + 0.5;
    vec3 sky = mix(vec3(0.08, 0.04, 0.18), vec3(0.02, 0.01, 0.06), y);

    // soft colored light sources
    float sun1 = pow(max(dot(dir, normalize(vec3(1.0, 0.8, 0.6))), 0.0), 16.0);
    float sun2 = pow(max(dot(dir, normalize(vec3(-0.7, 0.5, -0.5))), 0.0), 12.0);
    float sun3 = pow(max(dot(dir, normalize(vec3(0.0, -0.3, 1.0))), 0.0), 8.0);

    sky += vec3(0.8, 0.6, 0.3) * sun1 * 0.4;
    sky += vec3(0.3, 0.4, 0.8) * sun2 * 0.25;
    sky += vec3(0.5, 0.3, 0.6) * sun3 * 0.15;

    // animated nebula-like swirls
    float swirl = sin(dir.x * 4.0 + dir.y * 3.0 + t * 0.12) *
                  cos(dir.z * 3.5 - t * 0.08) * 0.5 + 0.5;
    sky += vec3(0.06, 0.03, 0.1) * swirl;

    return sky;
}

vec3 background(vec2 uv, float t) {
    vec3 dir = normalize(vec3(uv, -0.8));
    return envMap(dir, t);
}

// ─── fresnel ───────────────────────────────────────────────────────────

float fresnel(vec3 V, vec3 N, float f0) {
    float d = clamp(1.0 - dot(V, N), 0.0, 1.0);
    return f0 + (1.0 - f0) * d * d * d * d * d;
}

// ─── soft shadow for the glass on background ───────────────────────────

float glassAO(vec3 p, vec3 n, float oR, float h, float w, float r) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 4; i++) {
        float dist = 0.02 + 0.06 * float(i);
        float d = sdGlass(p + n * dist, oR, h, w, r);
        ao += (dist - d) * scale;
        scale *= 0.6;
    }
    return clamp(1.0 - ao * 3.0, 0.0, 1.0);
}

// ─── main ──────────────────────────────────────────────────────────────

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;

    // params
    float baseLevel = level.x * 1.0 - 0.5;
    float visc      = viscosity.x;
    float refStr    = refraction.x;
    float foamAmt   = foam.x;
    vec3  liqColor  = tint.xyz;

    float specShift = mid * 0.3 + treble * 0.2;
    liqColor = mix(liqColor, liqColor.gbr, specShift * 0.35);

    // audio
    float agitation = bass * 0.5 + peak * 0.3 + rms * 0.2;
    float beatPulse = pow(1.0 - beat_phase, 4.0);
    agitation += beatPulse * 0.4;
    agitation = clamp(agitation, 0.0, 1.0);

    float damp = mix(1.0, 0.2, visc);

    // bottle motion
    float swayX = (0.18 + agitation * 0.35) * sin(t * 0.55) * damp
                + agitation * 0.12 * sin(t * 1.0 + 0.5) * damp;
    float swayY = (0.03 + agitation * 0.06) * sin(t * 0.4 + 1.3) * damp;

    float rockZ = (0.12 + agitation * 0.22) * sin(t * 0.55) * damp
                + agitation * 0.1 * sin(t * 1.0) * damp;
    float rockX = (0.04 + agitation * 0.08) * sin(t * 0.4 + 1.3) * damp;

    mat3 bRot = rotZ(rockZ) * rotX(rockX);
    mat3 invRot = transpose(bRot);
    vec3 bCenter = vec3(swayX, swayY, 0.0);

    // glass dimensions
    float oR = 0.35, gH = 0.5, wall = 0.025, rnd = 0.035;

    // two light sources
    vec3 light1 = normalize(vec3(0.6, 1.0, 0.7));
    vec3 light2 = normalize(vec3(-0.5, 0.6, -0.4));
    vec3 light1Col = vec3(1.0, 0.95, 0.85);
    vec3 light2Col = vec3(0.5, 0.6, 0.9);

    // camera
    vec3 ro = vec3(0.0, 0.05, 2.4);
    vec3 rd = normalize(vec3(uv, -1.0));

    vec3 bgCol = background(uv, t);

    // ── ray march glass ────────────────────────────────────────────────
    float d = 0.0;
    bool hitGlass = false;
    vec3 hitB = vec3(0.0);

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 pW = ro + rd * d;
        vec3 pB = invRot * (pW - bCenter);
        float dist = sdGlass(pB, oR, gH, wall, rnd);
        if (dist < SURF_DIST) { hitGlass = true; hitB = pB; break; }
        if (d > MAX_DIST) break;
        d += dist;
    }

    if (!hitGlass) {
        fragColor = vec4(bgCol, 1.0);
        return;
    }

    vec3 hitW = ro + rd * d;
    vec3 nB = calcNormal(hitB, oR, gH, wall, rnd);
    vec3 nW = bRot * nB;

    // AO
    float ao = glassAO(hitB, nB, oR, gH, wall, rnd);

    // glass material — transparent with slight green tint like real glass
    float fres = fresnel(-rd, nW, 0.04);

    // reflection
    vec3 reflDir = reflect(rd, nW);
    vec3 envRefl = envMap(reflDir, t);
    envRefl += beatPulse * 0.08 * liqColor;

    // glass specular highlights
    float spec1 = pow(max(dot(reflDir, light1), 0.0), 64.0);
    float spec2 = pow(max(dot(reflDir, light2), 0.0), 48.0);
    vec3 glassSpec = light1Col * spec1 * 0.7 + light2Col * spec2 * 0.4;

    // diffuse on glass (very subtle — glass is mostly specular)
    float diff1 = max(dot(nW, light1), 0.0);
    float diff2 = max(dot(nW, light2), 0.0);
    vec3 glassDiff = (light1Col * diff1 + light2Col * diff2 * 0.5) * 0.06;

    // ── look through the glass — refract into interior ──────────────────
    float rockAngle = length(vec2(rockZ, rockX));
    float rockPhase = atan(rockX, rockZ);

    // slight refraction offset for visual effect, but march along original ray
    // to avoid bending artifacts inside the glass
    vec3 refractRay = refract(rd, nW, 1.0 / 1.5);
    if (length(refractRay) < 0.01) refractRay = rd;
    vec2 refractOffset = refractRay.xz - rd.xz; // used for background distortion

    float interiorStart = d + wall * 2.0;
    float stepSize = (gH * 2.0) / 64.0;
    float marchT = interiorStart;

    bool hitLiquid = false;
    vec3 liquidHitW = vec3(0.0);
    float liquidDepth = 0.0;

    for (int i = 0; i < 64; i++) {
        vec3 pW = ro + rd * marchT;
        vec3 pB = invRot * (pW - bCenter);

        float interior = sdInterior(pB, oR, gH, wall, rnd);
        if (interior > 0.04) break;

        float surfH = liquidSurface(pW.xz, baseLevel + bCenter.y,
                                     rockAngle, rockPhase, agitation, visc, t);
        if (pW.y > surfH) {
            // binary search refinement for precise surface location
            float lo = marchT - stepSize;
            float hi = marchT;
            for (int b = 0; b < 8; b++) {
                float mid = (lo + hi) * 0.5;
                vec3 mp = ro + rd * mid;
                float mh = liquidSurface(mp.xz, baseLevel + bCenter.y,
                                          rockAngle, rockPhase, agitation, visc, t);
                if (mp.y > mh) { hi = mid; } else { lo = mid; }
            }
            marchT = hi;
            hitLiquid = true;
            liquidHitW = ro + rd * marchT;

            // measure remaining depth through liquid
            for (int j = 0; j < 16; j++) {
                marchT += stepSize;
                vec3 pB2 = invRot * (ro + rd * marchT - bCenter);
                if (sdInterior(pB2, oR, gH, wall, rnd) > 0.0) break;
                liquidDepth += stepSize;
            }
            break;
        }
        marchT += stepSize;
    }

    vec3 throughCol; // what we see through the glass

    if (hitLiquid) {
        vec3 lNorm = liquidNormal(liquidHitW.xz, baseLevel + bCenter.y,
                                   rockAngle, rockPhase, agitation, visc, t);

        // refraction through liquid surface
        vec3 liqRefract = refract(rd, lNorm, 1.0 / 1.33); // water IOR
        if (length(liqRefract) < 0.01) liqRefract = rd;
        vec2 refUV = uv + (liqRefract.xz + refractOffset) * refStr * 0.3;
        vec3 refractedBg = background(refUV, t);

        // beer-lambert absorption — deeper = richer color
        float absorption = 1.0 - exp(-liquidDepth * 5.0);
        vec3 deepColor = liqColor * liqColor * 1.5; // deeper gets more saturated
        vec3 absorbColor = mix(liqColor, deepColor, absorption * 0.6);
        absorbColor *= (0.7 + 0.3 * absorption);

        throughCol = mix(refractedBg * 0.3, absorbColor, absorption * 0.75 + 0.25);

        // subsurface-like glow — light passing through the liquid
        float sss = pow(max(dot(rd, light1), 0.0), 3.0) * absorption;
        throughCol += liqColor * sss * 0.2;

        // specular highlights on liquid surface
        vec3 lRefl = reflect(-light1, lNorm);
        float lSpec1 = pow(max(dot(lRefl, -rd), 0.0), 48.0);
        lRefl = reflect(-light2, lNorm);
        float lSpec2 = pow(max(dot(lRefl, -rd), 0.0), 32.0);
        throughCol += light1Col * lSpec1 * 0.45 + light2Col * lSpec2 * 0.25;

        // liquid surface fresnel
        float lFres = fresnel(-rd, lNorm, 0.02);
        throughCol = mix(throughCol, envRefl * 0.5, lFres * 0.2);

        // foam near surface
        float surfH = liquidSurface(liquidHitW.xz, baseLevel + bCenter.y,
                                     rockAngle, rockPhase, agitation, visc, t);
        float surfDist = abs(liquidHitW.y - surfH);
        float foamMask = smoothstep(0.035, 0.0, surfDist) * foamAmt;
        foamMask *= (0.3 + agitation * 0.7);

        // soft foam noise — low frequency to avoid aliasing
        float fn = 0.5 + 0.5 * sin(liquidHitW.x * 14.0 + t * 0.4) *
                   cos(liquidHitW.z * 12.0 - t * 0.3);
        fn *= 0.6 + 0.4 * sin(length(liquidHitW.xz) * 10.0 + t * 0.5);
        foamMask *= fn * (0.5 + treble * 0.5);

        vec3 foamColor = mix(vec3(1.0, 0.98, 0.95), liqColor * 1.3 + 0.4, 0.25);
        throughCol = mix(throughCol, foamColor, clamp(foamMask, 0.0, 0.55));

    } else {
        // empty glass above liquid — see through with glass refraction
        vec2 refUV = uv + refractOffset * refStr * 0.15;
        throughCol = background(refUV, t);
    }

    // ── composite glass surface ────────────────────────────────────────
    // glass is mostly transparent with fresnel reflections and specular
    vec3 glassTint = vec3(0.97, 0.99, 1.0); // very slight cool tint
    vec3 col = throughCol * glassTint;

    // edge darkening — thicker glass at edges absorbs more light
    float edgeDark = pow(1.0 - abs(dot(-rd, nW)), 1.5);
    col *= 1.0 - edgeDark * 0.3;

    // add glass specular highlights
    col += glassSpec;

    // fresnel reflection
    col = mix(col, envRefl, fres * 0.4);

    // diffuse
    col += glassDiff * ao;

    // rim highlight — bright edge catch
    float rim = pow(1.0 - abs(dot(-rd, nW)), 4.0);
    col += vec3(0.2, 0.22, 0.28) * rim * ao;

    // top rim of the glass — bright highlight where we see the glass thickness
    vec3 topRimB = hitB;
    float atTop = smoothstep(gH - 0.02, gH + 0.01, topRimB.y);
    float rimRing = atTop * smoothstep(oR - wall - 0.01, oR - wall + 0.01, length(topRimB.xz));
    col += vec3(0.3, 0.32, 0.35) * rimRing * 0.5;

    // beat flash
    col += liqColor * beatPulse * 0.04;

    // tone mapping
    col = col / (col + 0.8);
    col = pow(col, vec3(0.92));

    fragColor = vec4(col, 1.0);
}
