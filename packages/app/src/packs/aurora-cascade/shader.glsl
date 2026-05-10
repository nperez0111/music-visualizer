// Aurora Cascade — northern lights / aurora borealis visualizer
// Curtains of shimmering light that cascade with audio reactivity.
// Bass drives wave amplitude, treble affects shimmer speed,
// beat_phase creates brightness pulses.

// ---------------------------------------------------------------
// Noise functions
// ---------------------------------------------------------------

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    // Smooth interpolation
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash2(i + vec2(0.0, 0.0));
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        value += amplitude * vnoise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// ---------------------------------------------------------------
// Aurora curtain layer
// ---------------------------------------------------------------

// Generates a single curtain of aurora light.
// x  = horizontal position (0..1)
// t  = time offset
// amp = wave amplitude (bass-driven)
// freq = shimmer frequency (treble-driven)
float curtain(float x, float t, float amp, float freq) {
    // Primary slow wave
    float wave = sin(x * 3.0 + t * 0.4) * 0.5;
    // Secondary faster undulation
    wave += sin(x * 7.0 - t * 0.7) * 0.25 * amp;
    // Tertiary high-frequency shimmer
    wave += sin(x * 13.0 + t * freq) * 0.12 * amp;
    // Very high frequency sparkle
    wave += sin(x * 23.0 - t * freq * 1.5) * 0.06;
    return wave;
}

// Soft glow falloff for a curtain at a given vertical distance
float curtainGlow(float dist, float width) {
    float d = abs(dist) / width;
    return exp(-d * d * 4.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord.xy / iResolution.xy;
    float aspect = iResolution.x / iResolution.y;

    // Time scaled by speed parameter
    float t = iTime * speed.x;

    // Number of curtain layers from parameter
    int numLayers = int(layers.x);

    // Audio-reactive modulation
    float bassAmp = 1.0 + bass * 2.5;       // Bass boosts wave amplitude
    float trebleFreq = 1.0 + treble * 3.0;  // Treble speeds up shimmer
    float midGlow = 1.0 + mid * 0.5;        // Mid adds glow intensity
    float energy = 0.7 + rms * 0.6;         // Overall energy

    // Beat pulse: sharp attack, smooth decay
    float beatPulse = pow(1.0 - beat_phase, 4.0);

    // Deep dark background — navy to black gradient
    vec3 bg = mix(vec3(0.0, 0.0, 0.02), vec3(0.01, 0.01, 0.06), uv.y);

    // Subtle star field in the background
    float stars = pow(hash2(floor(uv * vec2(aspect * 200.0, 200.0))), 20.0);
    bg += vec3(stars * 0.3);

    // Accumulate aurora color
    vec3 aurora = vec3(0.0);

    // Base tint from parameter
    vec3 baseTint = tint.xyz;

    for (int i = 0; i < 8; i++) {
        if (i >= numLayers) break;

        float fi = float(i);
        float layerOffset = fi * 1.618; // Golden ratio spacing

        // Each layer has a slightly different horizontal position and speed
        float layerSpeed = t * (0.3 + fi * 0.08);
        float xCoord = uv.x * aspect + layerOffset;

        // FBM-based curtain shape (gives organic waviness)
        float noiseVal = fbm(vec2(xCoord * 0.8 + layerSpeed * 0.1,
                                   fi * 3.7 + t * 0.05), 5);

        // Curtain sine wave + noise for organic shape
        float cWave = curtain(xCoord, layerSpeed, bassAmp, trebleFreq);
        cWave += (noiseVal - 0.5) * 0.4 * bassAmp;

        // Vertical position of this curtain (top-heavy, cascading down)
        float curtainY = 0.7 - fi * 0.06 + cWave * 0.15;

        // Distance from this pixel to the curtain center
        float dist = uv.y - curtainY;

        // Curtain width varies with noise
        float width = 0.08 + noiseVal * 0.06 + bass * 0.03;

        // Glow intensity
        float glow = curtainGlow(dist, width);

        // Only render above the curtain center (aurora hangs from above)
        // But allow some bleed below
        float topBias = smoothstep(-0.15, 0.05, dist);
        glow *= mix(1.0, topBias, 0.5);

        // Color gradient per layer: green -> cyan -> purple
        float colorPhase = fi / max(float(numLayers) - 1.0, 1.0);
        vec3 green  = vec3(0.1, 0.9, 0.3);
        vec3 cyan   = vec3(0.1, 0.8, 0.9);
        vec3 purple = vec3(0.6, 0.2, 0.9);

        vec3 layerColor;
        if (colorPhase < 0.5) {
            layerColor = mix(green, cyan, colorPhase * 2.0);
        } else {
            layerColor = mix(cyan, purple, (colorPhase - 0.5) * 2.0);
        }

        // Blend with user tint
        layerColor = mix(layerColor, baseTint, 0.3);

        // High-frequency shimmer detail
        float shimmer = vnoise(vec2(xCoord * 15.0 + t * trebleFreq * 0.5,
                                     uv.y * 20.0 - t * 0.3));
        shimmer = 0.7 + 0.3 * shimmer;

        // Accumulate this layer
        float layerAlpha = glow * shimmer * energy * midGlow;
        layerAlpha *= (0.4 + 0.6 / (1.0 + fi * 0.3)); // Fade distant layers

        aurora += layerColor * layerAlpha;
    }

    // Beat pulse brightens the whole aurora
    aurora *= 1.0 + beatPulse * 1.2;

    // Add subtle vertical rays (magnetic field lines)
    float rays = vnoise(vec2(uv.x * aspect * 8.0 + t * 0.1, t * 0.05));
    rays = pow(rays, 3.0) * 0.15 * uv.y;
    aurora += vec3(0.05, 0.2, 0.1) * rays * energy;

    // Edge fade (aurora is stronger in the upper half)
    float verticalFade = smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.6, uv.y);
    aurora *= verticalFade;

    // Combine background + aurora
    vec3 col = bg + aurora;

    // Subtle vignette
    vec2 vig = uv * (1.0 - uv);
    float vigFactor = pow(vig.x * vig.y * 16.0, 0.15);
    col *= vigFactor;

    // Tone mapping (soft clamp)
    col = col / (1.0 + col);

    fragColor = vec4(col, 1.0);
}
