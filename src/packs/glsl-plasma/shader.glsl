// Classic plasma effect -- Shadertoy convention, Cat Nip audio-reactive
//
// Uses iTime / iResolution (Shadertoy aliases) plus Cat Nip audio uniforms
// (bass, mid, treble, beat_phase) for reactivity.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float t = iTime;

    // Audio-reactive parameters
    float speed   = 1.0 + bass * 2.0;
    float scale   = 10.0 + mid * 5.0;
    float warp    = 0.5 + treble * 1.5;
    float pulse   = 0.8 + 0.2 * sin(beat_phase * 6.28318);

    // Classic plasma: sum of sines
    float v = 0.0;
    v += sin(uv.x * scale + t * speed);
    v += sin(uv.y * scale + t * speed * 0.7);
    v += sin((uv.x + uv.y) * scale * 0.5 + t * speed * 1.3);
    v += sin(length(uv - 0.5) * scale * warp - t * speed * 0.9);
    v = v / 4.0 + 0.5;

    // Color palette
    float r = 0.5 + 0.5 * cos(6.28318 * (v + 0.0 + t * 0.1));
    float g = 0.5 + 0.5 * cos(6.28318 * (v + 0.33 + t * 0.1));
    float b = 0.5 + 0.5 * cos(6.28318 * (v + 0.67 + t * 0.1));

    fragColor = vec4(r * pulse, g * pulse, b * pulse, 1.0);
}
