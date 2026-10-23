// --- Terrain GLSL Shader Chunks (injected via onBeforeCompile) ---
// Compatible with THREE.MeshStandardMaterial's fog uniform system.

export const TERRAIN_VERT_PARS = /* glsl */`
// Terrain vertex additions
varying vec3 vWorldPos;
varying float vElevation;
uniform float uTime;
`;

export const TERRAIN_VERT_BEGIN = /* glsl */`
vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
vElevation = position.y;
`;

export const NOISE_LIB = /* glsl */`
float hash13(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.zxy, p.yxz + 19.19);
    return fract(p.x * p.y * p.z);
}
float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash13(i),               hash13(i+vec3(1,0,0)), f.x),
            mix(hash13(i+vec3(0,1,0)),   hash13(i+vec3(1,1,0)), f.x), f.y),
        mix(mix(hash13(i+vec3(0,0,1)),   hash13(i+vec3(1,0,1)), f.x),
            mix(hash13(i+vec3(0,1,1)),   hash13(i+vec3(1,1,1)), f.x), f.y),
        f.z);
}
float fbm5(vec3 p) {
    float v=0.0; float amp=0.5; float freq=1.0;
    for(int i=0;i<5;i++){ v+=amp*vnoise(p*freq); amp*=0.48; freq*=2.07; }
    return v;
}
float warpedFbm(vec3 p, float ws) {
    vec3 q=vec3(fbm5(p+vec3(0.0,0.0,0.0)),fbm5(p+vec3(5.2,1.3,2.8)),fbm5(p+vec3(2.1,8.7,4.1)));
    return fbm5(p+ws*q);
}
`;

export const TERRAIN_FRAG_PARS = /* glsl */`
varying vec3 vWorldPos;
varying float vElevation;
uniform float uTime;
uniform float uIsFG;
float hash13(vec3 p){p=fract(p*vec3(443.8975,397.2973,491.1871));p+=dot(p.zxy,p.yxz+19.19);return fract(p.x*p.y*p.z);}
float vnoise(vec3 p){vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm5(vec3 p){float v=0.0;float amp=0.5;float fr=1.0;for(int i=0;i<5;i++){v+=amp*vnoise(p*fr);amp*=0.48;fr*=2.07;}return v;}
float warpedFbm(vec3 p,float ws){vec3 q=vec3(fbm5(p+vec3(0.0,0.0,0.0)),fbm5(p+vec3(5.2,1.3,2.8)),fbm5(p+vec3(2.1,8.7,4.1)));return fbm5(p+ws*q);}
`;

export const TERRAIN_FRAG_COLOR = /* glsl */`
vec3 wp = vWorldPos;
vec3 baseTex = diffuseColor.rgb;

if (uIsFG > 0.5) {
    // --- FOREGROUND TERRAIN: calibrated to slate-blue arctic reference ---
    float micro1 = vnoise(wp * 3.2 + vec3(0.0, uTime * 0.02, 0.0));
    float micro2 = vnoise(wp * 7.0);
    float fineGrain = micro1 * 0.6 + micro2 * 0.4;
    
    // Wind-swept sastrugi directional streaks across the slope
    float windStreaks = sin(wp.x * 2.0 + wp.z * 1.3 + fineGrain * 2.8) * 0.5 + 0.5;

    // Palette calibrated directly to the reference image
    vec3 colShadow    = vec3(0.295, 0.319, 0.382);
    vec3 colMidDark   = vec3(0.431, 0.453, 0.502);
    vec3 colMid       = vec3(0.488, 0.509, 0.556);
    vec3 colHighlight = vec3(0.595, 0.616, 0.660);
    vec3 colCrest     = vec3(0.680, 0.710, 0.760);

    float texLuma = dot(baseTex, vec3(0.299, 0.587, 0.114));
    float combinedH = clamp(texLuma * 0.72 + fineGrain * 0.18 + windStreaks * 0.10, 0.0, 1.0);

    vec3 graded;
    if (combinedH < 0.32) {
        graded = mix(colShadow, colMidDark, smoothstep(0.0, 0.32, combinedH));
    } else if (combinedH < 0.60) {
        graded = mix(colMidDark, colMid, smoothstep(0.32, 0.60, combinedH));
    } else if (combinedH < 0.82) {
        graded = mix(colMid, colHighlight, smoothstep(0.60, 0.82, combinedH));
    } else {
        graded = mix(colHighlight, colCrest, smoothstep(0.82, 1.0, combinedH));
    }

    diffuseColor.rgb = mix(baseTex * 0.96, graded, 0.65);

} else {
    // --- BACKGROUND MOUNTAINS: multi-scale crags with atmospheric depth ---
    float largeScale  = warpedFbm(wp * 0.11 + vec3(0.0, 0.0, uTime * 0.008), 0.9);
    float mediumScale = fbm5(wp * 0.38 + vec3(3.1, 0.0, uTime * 0.013));
    float fineDetail  = fbm5(wp * 1.25 + vec3(9.3, 2.7, 0.0));
    float micro       = vnoise(wp * 3.8 + vec3(0.0, uTime * 0.04, 0.0));
    float surfaceH    = largeScale * 0.45 + mediumScale * 0.30 + fineDetail * 0.18 + micro * 0.07;

    float texLuma = dot(baseTex, vec3(0.299, 0.587, 0.114));
    float combinedH = clamp(texLuma * 0.60 + surfaceH * 0.40, 0.0, 1.0);

    vec3 colShadow    = vec3(0.28, 0.31, 0.37);
    vec3 colMidDark   = vec3(0.41, 0.44, 0.50);
    vec3 colMid       = vec3(0.49, 0.52, 0.57);
    vec3 colHighlight = vec3(0.60, 0.63, 0.68);
    vec3 colCrest     = vec3(0.70, 0.73, 0.78);

    vec3 graded;
    if (combinedH < 0.32) {
        graded = mix(colShadow, colMidDark, smoothstep(0.0, 0.32, combinedH));
    } else if (combinedH < 0.60) {
        graded = mix(colMidDark, colMid, smoothstep(0.32, 0.60, combinedH));
    } else if (combinedH < 0.82) {
        graded = mix(colMid, colHighlight, smoothstep(0.60, 0.82, combinedH));
    } else {
        graded = mix(colHighlight, colCrest, smoothstep(0.82, 1.0, combinedH));
    }

    // Atmospheric depth blend
    vec3 fogColor = vec3(0.710, 0.753, 0.796);
    float bgBlend = smoothstep(0.0, 1.0, mediumScale * 0.6 + largeScale * 0.4);
    graded = mix(graded, fogColor, 0.20 + bgBlend * 0.16);

    diffuseColor.rgb = mix(baseTex * 0.90, graded, 0.68);
}
`;
