// Star Nest by Pablo Roman Andrioli
// This content is under the MIT License.
// Source: https://www.shadertoy.com/view/XlfGRj
//
// Adapted for Cat Nip with audio reactivity.

#define iterations 17
#define formuparam 0.53

#define volsteps 20
#define stepsize 0.1

#define zoom   0.800
#define tile   0.850

#define darkmatter 0.300
#define saturation 0.850

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    // Audio-reactive parameters
    float speed = 0.010 + bass * 0.005;
    float brightness = 0.0015 + rms * 0.002;
    float distfading = 0.730 - treble * 0.1;

    // Get coords and direction
    vec2 uv = fragCoord.xy / iResolution.xy - 0.5;
    uv.y *= iResolution.y / iResolution.x;
    vec3 dir = vec3(uv * zoom, 1.0);
    float time = iTime * speed + 0.25;

    // Camera rotation - audio-reactive wobble
    float a1 = 0.5 + time * 0.3 + mid * 0.1;
    float a2 = 0.8 + time * 0.2 + treble * 0.05;
    mat2 rot1 = mat2(cos(a1), sin(a1), -sin(a1), cos(a1));
    mat2 rot2 = mat2(cos(a2), sin(a2), -sin(a2), cos(a2));
    dir.xz *= rot1;
    dir.xy *= rot2;
    vec3 from = vec3(1.0, 0.5, 0.5);
    from += vec3(time * 2.0, time, -2.0);
    from.xz *= rot1;
    from.xy *= rot2;

    // Volumetric rendering
    float s = 0.1, fade = 1.0;
    vec3 v = vec3(0.0);
    for (int r = 0; r < volsteps; r++) {
        vec3 p = from + s * dir * 0.5;
        p = abs(vec3(tile) - mod(p, vec3(tile * 2.0))); // tiling fold
        float pa, a = pa = 0.0;
        for (int i = 0; i < iterations; i++) {
            p = abs(p) / dot(p, p) - formuparam; // the magic formula
            a += abs(length(p) - pa); // absolute sum of average change
            pa = length(p);
        }
        float dm = max(0.0, darkmatter - a * a * 0.001); // dark matter
        a *= a * a; // add contrast
        if (r > 6) fade *= 1.0 - dm; // dark matter, don't render near
        v += fade;

        // Audio-reactive coloring: beat_phase pulses brightness
        float pulse = 1.0 + beat_phase * peak * 0.5;
        v += vec3(s, s * s, s * s * s * s) * a * brightness * fade * pulse;
        fade *= distfading; // distance fading
        s += stepsize;
    }
    v = mix(vec3(length(v)), v, saturation); // color adjust

    // Audio-reactive final color boost
    float energy = 1.0 + rms * 0.5;
    fragColor = vec4(v * 0.01 * energy, 1.0);
}
