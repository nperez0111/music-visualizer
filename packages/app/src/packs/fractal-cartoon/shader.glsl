// "Fractal Cartoon" - based on "DE edge detection" by Kali
// https://www.shadertoy.com/view/XsBXWt
//
// Raymarched fractal landscape with cartoon edge detection.
// Adapted for Cat Nip: iChannel textures replaced with audio uniforms
// and procedural effects.

#define RAY_STEPS 150
#define GAMMA 1.4
#define SATURATION .65

#define detail .001

float det = 0.0;

const vec3 origin = vec3(-1., .7, 0.);

// 2D rotation function
mat2 rot(float a) {
    return mat2(cos(a), sin(a), -sin(a), cos(a));
}

// "Amazing Surface" fractal
vec4 formula(vec4 p) {
    p.xz = abs(p.xz + 1.) - abs(p.xz - 1.) - p.xz;
    p.y -= .25;
    p.xy *= rot(radians(35.));
    p = p * 2. / clamp(dot(p.xyz, p.xyz), .2, 1.);
    return p;
}

// Distance function
float de(vec3 pos, float timeVal, float waveAmt) {
    pos.y += sin(pos.z - timeVal * 3.) * .15 * waveAmt; // waves controlled by parameter + audio
    float hid = 0.;
    vec3 tpos = pos;
    tpos.z = abs(3. - mod(tpos.z, 6.));
    vec4 p = vec4(tpos, 1.);
    for (int i = 0; i < 4; i++) { p = formula(p); }
    float fr = (length(max(vec2(0.), p.yz - 1.5)) - 1.) / p.w;
    float ro = max(abs(pos.x + 1.) - .3, pos.y - .35);
    ro = max(ro, -max(abs(pos.x + 1.) - .1, pos.y - .5));
    pos.z = abs(.25 - mod(pos.z, .5));
    ro = max(ro, -max(abs(pos.z) - .2, pos.y - .3));
    ro = max(ro, -max(abs(pos.z) - .01, -pos.y + .32));
    float d = min(fr, ro);
    return d;
}

// Camera path
vec3 path(float ti) {
    ti *= 1.5;
    vec3 p = vec3(sin(ti), (1. - sin(ti * 2.)) * .5, -ti * 5.) * .5;
    return p;
}

// Calc normals + edge detection
float edge = 0.;
vec3 normal(vec3 p, float timeVal, float waveAmt) {
    vec3 e = vec3(0.0, det * 5., 0.0);

    float d1 = de(p - e.yxx, timeVal, waveAmt), d2 = de(p + e.yxx, timeVal, waveAmt);
    float d3 = de(p - e.xyx, timeVal, waveAmt), d4 = de(p + e.xyx, timeVal, waveAmt);
    float d5 = de(p - e.xxy, timeVal, waveAmt), d6 = de(p + e.xxy, timeVal, waveAmt);
    float d = de(p, timeVal, waveAmt);
    edge = abs(d - 0.5 * (d2 + d1)) + abs(d - 0.5 * (d4 + d3)) + abs(d - 0.5 * (d6 + d5));
    edge = min(1., pow(edge, .55) * 15.);
    return normalize(vec3(d1 - d2, d3 - d4, d5 - d6));
}

// Procedural rainbow trail (replaces Nyan Cat texture code)
vec4 rainbow(vec2 p, float timeVal) {
    float q = max(p.x, -0.1);
    float s = sin(p.x * 7.0 + timeVal * 35.0) * 0.08;
    p.y += s;
    p.y *= 1.1;

    vec4 c;
    if (p.x > 0.0) c = vec4(0, 0, 0, 0); else
    if (0.0 / 6.0 < p.y && p.y < 1.0 / 6.0) c = vec4(255, 43, 14, 255) / 255.0; else
    if (1.0 / 6.0 < p.y && p.y < 2.0 / 6.0) c = vec4(255, 168, 6, 255) / 255.0; else
    if (2.0 / 6.0 < p.y && p.y < 3.0 / 6.0) c = vec4(255, 244, 0, 255) / 255.0; else
    if (3.0 / 6.0 < p.y && p.y < 4.0 / 6.0) c = vec4(51, 234, 5, 255) / 255.0; else
    if (4.0 / 6.0 < p.y && p.y < 5.0 / 6.0) c = vec4(8, 163, 255, 255) / 255.0; else
    if (5.0 / 6.0 < p.y && p.y < 6.0 / 6.0) c = vec4(122, 85, 255, 255) / 255.0; else
    if (abs(p.y) - .05 < 0.0001) c = vec4(0., 0., 0., 1.); else
    if (abs(p.y - 1.) - .05 < 0.0001) c = vec4(0., 0., 0., 1.); else
        c = vec4(0, 0, 0, 0);
    c.a *= .8 - min(.8, abs(p.x * .08));
    c.xyz = mix(c.xyz, vec3(length(c.xyz)), .15);
    return c;
}

// Raymarching and 2D graphics
vec3 raymarch(in vec3 from, in vec3 dir, float timeVal, float waveAmt,
              float edgeStr, float bright, float audioEnergy) {
    edge = 0.;
    vec3 p, norm;
    float d = 100.;
    float totdist = 0.;
    for (int i = 0; i < RAY_STEPS; i++) {
        if (d > det && totdist < 25.0) {
            p = from + totdist * dir;
            d = de(p, timeVal, waveAmt);
            det = detail * exp(.13 * totdist);
            totdist += d;
        }
    }
    vec3 col = vec3(0.);
    p -= (det - d) * dir;
    norm = normal(p, timeVal, waveAmt);

    // Normal coloring with dark edges, edge_strength parameter controls edge darkness
    col = (1. - abs(norm)) * max(0., 1. - edge * edgeStr);

    totdist = clamp(totdist, 0., 26.);
    dir.y -= .02;

    // Sun size reactive to bass (replaces iChannel0 texture lookup)
    float sunsize = 7. - max(0., bass) * 5.;
    float an = atan(dir.x, dir.y) + timeVal * 3.; // rotating sun
    float s = pow(clamp(1.0 - length(dir.xy) * sunsize - abs(.2 - mod(an, .4)), 0., 1.), .1);
    float sb = pow(clamp(1.0 - length(dir.xy) * (sunsize - .2) - abs(.2 - mod(an, .4)), 0., 1.), .1);
    float sg = pow(clamp(1.0 - length(dir.xy) * (sunsize - 4.5) - .5 * abs(.2 - mod(an, .4)), 0., 1.), 3.);
    float y = mix(.45, 1.2, pow(smoothstep(0., 1., .75 - dir.y), 2.)) * (1. - sb * .5);

    // Sky and sun background -- pulse sun brightness with beat
    float beatPulse = 1.0 + 0.3 * pow(1.0 - beat_phase, 4.0);
    vec3 backg = vec3(0.5, 0., 1.) * ((1. - s) * (1. - sg) * y + (1. - sb) * sg * vec3(1., .8, 0.15) * 3. * beatPulse);
    backg += vec3(1., .9, .1) * s * beatPulse;
    backg = max(backg, sg * vec3(1., .9, .5));

    col = mix(vec3(1., .9, .3), col, exp(-.004 * totdist * totdist)); // distant fading
    if (totdist > 25.) col = backg;
    col = pow(col, vec3(GAMMA)) * bright;
    col = mix(vec3(length(col)), col, SATURATION);

    col *= vec3(1., .9, .85);

    // Rainbow trail -- audio-reactive position and visibility
    dir.yx *= rot(dir.x);
    float rainbowX = -3. + mod(-timeVal, 6.);
    vec2 ncatpos = (dir.xy + vec2(rainbowX, -.27));
    vec4 rain = rainbow(ncatpos * 10. + vec2(.8, .5), timeVal);
    // Only show rainbow when there's enough audio energy
    float rainAlpha = rain.a * .9 * smoothstep(0.1, 0.4, audioEnergy);
    if (totdist > 8.) col = mix(col, max(vec3(.2), rain.xyz), rainAlpha);

    return col;
}

// Get camera position
vec3 move(inout vec3 dir, float timeVal) {
    vec3 go = path(timeVal);
    vec3 adv = path(timeVal + .7);
    vec3 advec = normalize(adv - go);
    float an = adv.x - go.x;
    an *= min(1., abs(adv.z - go.z)) * sign(adv.z - go.z) * .7;
    dir.xy *= mat2(cos(an), sin(an), -sin(an), cos(an));
    an = advec.y * 1.7;
    dir.yz *= mat2(cos(an), sin(an), -sin(an), cos(an));
    an = atan(advec.x, advec.z);
    dir.xz *= mat2(cos(an), sin(an), -sin(an), cos(an));
    return go;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // Parameters: speed.x, brightness.x, wave_intensity.x, edge_strength.x
    float spd = speed.x;
    float bright = brightness.x;
    float waveAmt = wave_intensity.x + bass * 0.5; // bass amplifies waves
    float edgeStr = edge_strength.x;

    float timeVal = iTime * 0.5 * spd;

    vec2 uv = fragCoord.xy / iResolution.xy * 2. - 1.;
    vec2 oriuv = uv;
    uv.y *= iResolution.y / iResolution.x;

    float fov = .9 - max(0., .7 - iTime * .3);
    vec3 dir = normalize(vec3(uv * fov, 1.));

    // Slight camera shake from treble transients
    float shake = treble * 0.01;
    dir.x += sin(iTime * 37.0) * shake;
    dir.y += cos(iTime * 41.0) * shake;

    vec3 from = origin + move(dir, timeVal);

    float audioEnergy = rms * 0.5 + bass * 0.3 + mid * 0.2;

    vec3 color = raymarch(from, dir, timeVal, waveAmt, edgeStr, bright, audioEnergy);

    // Vignette border
    color = mix(vec3(0.), color, pow(max(0., .95 - length(oriuv * oriuv * oriuv * vec2(1.05, 1.1))), .3));

    fragColor = vec4(color, 1.);
}
