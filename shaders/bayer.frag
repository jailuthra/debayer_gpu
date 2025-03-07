#version 310 es
precision mediump float;

in vec2 v_texCoord;

uniform sampler2D u_texture;
uniform int bayerPattern; // 0: BGGR, 1: GBRG, 2: GRBG, 3: RGGB
uniform float blackLevel;
uniform float whiteLevel;
uniform vec3 whiteBalance;
uniform float scalingFactor; // for eg. 10b pixels in 16b container
uniform float gamma;

out vec4 fragColor;

float fetchPixel(sampler2D tex, ivec2 pos) {
    float rawValue = texelFetch(tex, pos, 0).r * scalingFactor;
    return clamp((rawValue - blackLevel) / (whiteLevel - blackLevel), 0.0, 1.0);
}

// Simplified color interpolation
void interpolateColors(sampler2D tex, ivec2 pixel, out float r, out float g, out float b) {
    // Determine pixel's position in the 2x2 Bayer pattern
    int x = pixel.x % 2;
    int y = pixel.y % 2;

    // Calculate the current pattern position (0-3)
    int patternPos = y * 2 + x;

    // Define the color at each position for each pattern type
    // Order: [0,0], [0,1], [1,0], [1,1] = [top-left, top-right, bottom-left, bottom-right]
    const int patternColors[4][4] = int[][4](
        int[4](2, 1, 1, 0), // BGGR: B,G,G,R
        int[4](1, 2, 0, 1), // GBRG: G,B,R,G
        int[4](1, 0, 2, 1), // GRBG: G,R,B,G
        int[4](0, 1, 1, 2)  // RGGB: R,G,G,B
    );

    // Get the color at the current pixel (0=R, 1=G, 2=B)
    int currentColor = patternColors[bayerPattern][patternPos];

    // Pre-compute common pixel offsets
    ivec2 right = ivec2(1, 0);
    ivec2 down = ivec2(0, 1);
    ivec2 diagDown = ivec2(1, 1);
    ivec2 diagUp = ivec2(1, -1);

    // Assign and interpolate based on current color
    if (currentColor == 0) {
        // We are on a red pixel
        r = fetchPixel(tex, pixel);
        g = (fetchPixel(tex, pixel + right) + fetchPixel(tex, pixel + down)) * 0.5;
        b = fetchPixel(tex, pixel + diagDown);
    } else if (currentColor == 2) {
        // We are on a blue pixel
        r = fetchPixel(tex, pixel - diagDown);
        g = (fetchPixel(tex, pixel - right) + fetchPixel(tex, pixel - down)) * 0.5;
        b = fetchPixel(tex, pixel);
    } else {
        // We are on a green pixel
        // Need to determine if it's in a red row or blue row
        // This depends on the specific Bayer pattern and position

        // Determine if horizontal neighbors are red or blue
        bool horizontalRed;
        if (bayerPattern > 1) horizontalRed = (y == 0); // RGGB or GRBG
        else horizontalRed = (y == 1); // BGGR or GBRG

        g = fetchPixel(tex, pixel);

        if (horizontalRed) {
            // Red horizontally, blue vertically
            r = (fetchPixel(tex, pixel - right) + fetchPixel(tex, pixel + right)) * 0.5;
            b = (fetchPixel(tex, pixel - down) + fetchPixel(tex, pixel + down)) * 0.5;
        } else {
            // Blue horizontally, red vertically
            r = (fetchPixel(tex, pixel - down) + fetchPixel(tex, pixel + down)) * 0.5;
            b = (fetchPixel(tex, pixel - right) + fetchPixel(tex, pixel + right)) * 0.5;
        }
    }
}

vec4 demosaic(sampler2D tex, ivec2 pixel) {
    float r, g, b;
    interpolateColors(tex, pixel, r, g, b);

    // Color enhancement and gamma correction
    r = pow(clamp(r * whiteBalance.r, 0.0, 1.0), 1.0/gamma);
    g = pow(clamp(g * whiteBalance.g, 0.0, 1.0), 1.0/gamma);
    b = pow(clamp(b * whiteBalance.b, 0.0, 1.0), 1.0/gamma);

    return vec4(r, g, b, 1.0);
}

void main() {
    ivec2 texSize = textureSize(u_texture, 0);
    ivec2 pixel = ivec2(v_texCoord * vec2(texSize));
    
    fragColor = demosaic(u_texture, pixel);
}
