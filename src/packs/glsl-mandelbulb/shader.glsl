// Mandelbulb fractal renderer
// Original by Pedro Tonini Rosenberg Schneider
// MIT License - https://github.com/pedrotrschneider/shader-fractals
//
// Adapted for Cat Nip with audio reactivity.

#define MaximumRaySteps 150
#define MaximumDistance 200.0
#define MinimumDistance 0.0001
#define PI 3.141592653589793238

mat2 Rotate(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

vec3 R(vec2 uv, vec3 p, vec3 l, float z) {
    vec3 f = normalize(l - p),
        r = normalize(cross(vec3(0, 1, 0), f)),
        u = cross(f, r),
        c = p + f * z,
        i = c + uv.x * r + uv.y * u,
        d = normalize(i - p);
    return d;
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float mandelbulb(vec3 position) {
    vec3 z = position;
    float dr = 1.0;
    float r = 0.0;
    // Audio-reactive power: bass drives the fractal exponent
    float power = 8.0 + bass * 3.0;

    for (int i = 0; i < 10; i++) {
        r = length(z);
        if (r > 2.0) break;

        // Convert to polar coordinates
        float theta = acos(z.z / r);
        float phi = atan(z.y, z.x);
        dr = pow(r, power - 1.0) * power * dr + 1.0;

        // Scale and rotate the point
        float zr = pow(r, power);
        theta = theta * power;
        phi = phi * power;

        // Convert back to cartesian coordinates
        z = zr * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta));
        z += position;
    }
    float dst = 0.5 * log(r) * r / dr;
    return dst;
}

float DistanceEstimator(vec3 p) {
    // Audio-reactive tilt
    p.yz *= Rotate(-0.3 * PI + mid * 0.1);
    return mandelbulb(p);
}

vec4 RayMarcher(vec3 ro, vec3 rd) {
    float steps = 0.0;
    float totalDistance = 0.0;
    float minDistToScene = 100.0;
    vec3 minDistToScenePos = ro;
    vec4 col = vec4(0.0, 0.0, 0.0, 1.0);
    vec3 curPos = ro;
    bool hit = false;

    for (steps = 0.0; steps < float(MaximumRaySteps); steps++) {
        vec3 p = ro + totalDistance * rd;
        float distance = DistanceEstimator(p);
        curPos = p;
        if (minDistToScene > distance) {
            minDistToScene = distance;
            minDistToScenePos = curPos;
        }
        totalDistance += distance;
        if (distance < MinimumDistance) {
            hit = true;
            break;
        } else if (distance > MaximumDistance) {
            break;
        }
    }

    // Audio-reactive hue shift via beat_phase
    float hueShift = beat_phase * 0.3;

    if (hit) {
        col.rgb = vec3(0.8 + hueShift + length(curPos) / 0.5, 1.0, 0.8);
        col.rgb = hsv2rgb(col.rgb);
    } else {
        col.rgb = vec3(0.8 + hueShift + length(minDistToScenePos) / 0.5, 1.0, 0.8);
        col.rgb = hsv2rgb(col.rgb);
        col.rgb *= 1.0 / (minDistToScene * minDistToScene);
        col.rgb /= mix(3000.0, 50000.0, 0.5 + 0.5 * sin(iTime * 3.0));
    }

    // Ambient occlusion + distance falloff
    col.rgb /= steps * 0.08;
    col.rgb /= pow(distance(ro, minDistToScenePos), 2.0);

    // Audio-reactive brightness boost on peaks
    float energy = 3.0 + peak * 5.0;
    col.rgb *= energy;

    return col;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    uv *= 1.5;

    vec3 ro = vec3(0, 0, -2.0);

    // Audio-reactive camera orbit
    float orbitSpeed = iTime * 2.0 * PI / 10.0 + treble * 0.2;
    ro.xz *= Rotate(orbitSpeed);

    vec3 rd = R(uv, ro, vec3(0, 0, 1), 1.0);

    vec4 col = RayMarcher(ro, rd);

    fragColor = vec4(col.rgb, 1.0);
}
