// Julia Set fractal renderer
// Original by Pedro Tonini Rosenberg Schneider
// MIT License - https://github.com/pedrotrschneider/shader-fractals
//
// Adapted for Cat Nip with audio reactivity and animated c-parameter.

#define PI 3.141592653589793238

// Audio-reactive iteration limit
#define RECURSION_LIMIT 500

int juliaSet(vec2 c, vec2 constant) {
    int recursionCount;
    vec2 z = c;

    for (recursionCount = 0; recursionCount < RECURSION_LIMIT; recursionCount++) {
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + constant;
        if (dot(z, z) > 4.0) break;
    }

    return recursionCount;
}

// Smooth iteration count for anti-banding
float smoothJulia(vec2 c, vec2 constant) {
    vec2 z = c;
    float i;

    for (i = 0.0; i < float(RECURSION_LIMIT); i += 1.0) {
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + constant;
        if (dot(z, z) > 256.0) break;
    }

    if (i >= float(RECURSION_LIMIT)) return i;

    // Smooth coloring via renormalization
    float sl = i - log2(log2(dot(z, z))) + 4.0;
    return sl;
}

vec3 palette(float t) {
    // Vibrant palette
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0, 0.10, 0.20);
    return a + b * cos(6.28318 * (c * t + d));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = 2.0 * (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    // Audio-reactive zoom
    float zoomLevel = 1.5 - bass * 0.3;
    uv *= zoomLevel;

    // Audio-reactive rotation
    float a = PI / 3.0 + mid * 0.2;
    vec2 U = vec2(cos(a), sin(a));
    vec2 V = vec2(-U.y, U.x);
    uv = vec2(dot(uv, U), dot(uv, V));

    // Animated c-parameter: cycles through interesting Julia sets
    // Audio drives the orbit speed and radius
    float t = iTime * 0.3 + beat_phase * 0.1;
    float radius = 0.7885 + treble * 0.05;
    vec2 constant = radius * vec2(cos(t), sin(t));

    // Smooth fractal evaluation
    float f = smoothJulia(uv, constant);

    vec3 col;
    if (f >= float(RECURSION_LIMIT)) {
        // Interior: dark with subtle audio glow
        col = vec3(0.02) + vec3(0.05, 0.0, 0.1) * rms;
    } else {
        // Exterior: smooth palette coloring
        float normalized = f / 50.0; // normalize for palette

        // Audio-reactive hue shift
        float hueShift = beat_phase * 0.3 + bass * 0.1;
        col = palette(normalized + hueShift);

        // Brightness based on proximity
        float glow = 1.0 - f / float(RECURSION_LIMIT);
        col *= 1.0 + glow * peak * 2.0;
    }

    // Audio-reactive brightness
    float energy = 0.8 + rms * 0.4;
    col *= energy;

    // Slight vignette
    vec2 q = fragCoord.xy / iResolution.xy;
    col *= 0.5 + 0.5 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.1);

    fragColor = vec4(col, 1.0);
}
