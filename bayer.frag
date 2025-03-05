#version 310 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_texture;

out vec4 fragColor;

float fetchPixel(sampler2D tex, ivec2 pos) {
    const float blackLevel = 0.0627;
    const float whiteLevel = 1.0;
    const float bppScalingFactor = 64.0;
    float rawValue = texelFetch(tex, pos, 0).r * bppScalingFactor;
    return clamp((rawValue - blackLevel) / (whiteLevel - blackLevel), 0.0, 1.0);
}

// Simplified color interpolation
void interpolateColors(sampler2D tex, ivec2 pixel, out float r, out float g, out float b) {
    int x = pixel.x % 2;
    int y = pixel.y % 2;

    // Pre-compute common pixel offsets
    ivec2 right = ivec2(1, 0);
    ivec2 down = ivec2(0, 1);
    ivec2 diagDown = ivec2(1, 1);
    ivec2 diagUp = ivec2(1, -1);

    // Use array to simplify pattern selection
    const int patterns[4][3] = int[][3](
        // RGGB
        int[3](0, 1, 2),
        // BGGR 
        int[3](2, 1, 0),
        // GRBG
        int[3](1, 0, 2),
        // GBRG
        int[3](1, 2, 0)
    );

    const int u_bayerPattern = 0; // 0: RGGB, 1: BGGR, 2: GRBG, 3: GBRG
    // Select color order based on pattern
    int colorOrder[3] = patterns[u_bayerPattern];

    // Simplified color extraction logic
    if (y == 0) {
        if (x == 0) {
            // Top-left pixel
            float colors[3] = float[3](
                fetchPixel(tex, pixel),
                (fetchPixel(tex, pixel + right) + fetchPixel(tex, pixel + down)) * 0.5,
                fetchPixel(tex, pixel + diagDown)
            );
            r = colors[colorOrder[0]];
            g = colors[colorOrder[1]];
            b = colors[colorOrder[2]];
        } else {
            // Top-right pixel
            float colors[3] = float[3](
                fetchPixel(tex, pixel - right),
                fetchPixel(tex, pixel),
                fetchPixel(tex, pixel + down)
            );
            r = colors[colorOrder[0]];
            g = colors[colorOrder[1]];
            b = colors[colorOrder[2]];
        }
    } else {
        if (x == 0) {
            // Bottom-left pixel
            float colors[3] = float[3](
                fetchPixel(tex, pixel - down),
                fetchPixel(tex, pixel),
                fetchPixel(tex, pixel + right)
            );
            r = colors[colorOrder[0]];
            g = colors[colorOrder[1]];
            b = colors[colorOrder[2]];
        } else {
            // Bottom-right pixel
            float colors[3] = float[3](
                fetchPixel(tex, pixel - diagDown),
                (fetchPixel(tex, pixel - right) + fetchPixel(tex, pixel - down)) * 0.5,
                fetchPixel(tex, pixel)
            );
            r = colors[colorOrder[0]];
            g = colors[colorOrder[1]];
            b = colors[colorOrder[2]];
        }
    }
}

vec4 demosaic(sampler2D tex, ivec2 pixel) {
    float r, g, b;
    interpolateColors(tex, pixel, r, g, b);
    vec3 wb = vec3(1.8, 1.0, 1.5);
    float gamma = 1.2;

    // Color enhancement and gamma correction
    r = pow(clamp(r * wb.r, 0.0, 1.0), 1.0/gamma);
    g = pow(clamp(g * wb.g, 0.0, 1.0), 1.0/gamma);
    b = pow(clamp(b * wb.b, 0.0, 1.0), 1.0/gamma);

    return vec4(r, g, b, 1.0);
}

void main() {
    ivec2 texSize = textureSize(u_texture, 0);
    vec2 flippedCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
    ivec2 pixel = ivec2(flippedCoord * vec2(texSize));
    
    fragColor = demosaic(u_texture, pixel);
}
