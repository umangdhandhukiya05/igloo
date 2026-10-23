// --- Wind Mist / Blizzard Ground Smoke (GPU ShaderMaterial) ---
// Large planes (billboards) with animated procedural smoke shape.
// Blending mode: NormalBlending. Sorted back-to-front for correct transparency.

export const WIND_MIST_VERT = /* glsl */`
attribute float aSpeed;
attribute float aSeed;
attribute float aScale;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
uniform float uTime;

void main() {
    vUv   = uv;
    vSeed = aSeed;

    // Drift in wind direction
    float t = uTime * aSpeed;
    vec3 pos = position;

    // Slight Y bobbing to hug the ground
    float yBob = sin(uTime * 0.45 + aSeed * 6.28) * 0.18;
    pos.y += yBob;

    // Breathing scale pulse
    float scalePulse = 1.0 + 0.06 * sin(uTime * 0.8 + aSeed * 3.14);
    pos.xy *= scalePulse;

    vFade = 0.55 + 0.45 * sin(uTime * 0.32 + aSeed * 2.71);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const WIND_MIST_FRAG = /* glsl */`
varying vec2 vUv;
varying float vFade;
varying float vSeed;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCameraPos;
// worldPos approximation via varying would be ideal; we derive from gl_FragCoord

float h13(vec3 p){ p=fract(p*vec3(443.9,397.3,491.2)); p+=dot(p.zxy,p.yxz+19.19); return fract(p.x*p.y*p.z); }
float vn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h13(vec3(i,0.0)),h13(vec3(i+vec2(1,0),0.0)),f.x), mix(h13(vec3(i+vec2(0,1),0.0)),h13(vec3(i+vec2(1,1),0.0)),f.x), f.y); }
float fbm4(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<4;i++){ v+=a*vn(p); a*=0.5; p*=2.03; } return v; }

void main() {
    vec2 uv = vUv - 0.5; // Center

    // Radial falloff for soft cloud shape
    float r = length(uv) * 2.0;
    float radial = 1.0 - smoothstep(0.25, 1.0, r);

    // Animated smoke shape using 2-pass domain-warped FBM
    vec2 q  = vUv * 2.8 + vec2(uTime * 0.018 + vSeed * 0.9, uTime * 0.012);
    vec2 q2 = q + vec2(fbm4(q + vec2(1.7, 9.2)) * 0.8, fbm4(q + vec2(8.3, 2.8)) * 0.8);
    float smoke = fbm4(q2);

    // Threshold + blend
    float shape = smoothstep(0.30, 0.65, smoke) * radial;

    // Alpha — keep subtle; opacity modulated by uOpacity
    float alpha = shape * vFade * uOpacity;
    alpha = clamp(alpha, 0.0, 0.9);

    // Color: cold icy white with very faint blue tint
    vec3 col = vec3(0.88, 0.92, 0.97);
    // Darken slightly inside denser regions for volumetric feel
    col *= 0.85 + smoke * 0.22;

    // Manual exponential fog to match scene FogExp2(FOG_COLOR, 0.005)
    // We don't have world pos here, so we soften distant mist via alpha
    col = mix(col, uFogColor, 0.12);

    gl_FragColor = vec4(col, alpha);
}
`;
