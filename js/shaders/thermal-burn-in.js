export function startThermalBurnIn(canvas) {
  if (!canvas) return false;

  // Sync the WebGL drawing-buffer size with the CSS-driven layout size.
  // This fires on initial layout and whenever the element is resized.
  function syncSize() {
    const w = canvas.clientWidth  || 1280;
    const h = canvas.clientHeight || 720;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncSize).observe(canvas);
  }
  syncSize();

  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) return;
  const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
  const fs = `precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_texCoord;

// Simplex-ish noise helper
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
    vec2 uv = v_texCoord;
    
    // Thermal Print Head Heat Distortion & Burn-In Wave Simulation
    // Active heat array moves down or pulsates across thermal line passes
    float t = u_time * 1.5;
    
    // Heat wave shimmer and micro-refraction
    float heatWaveY = sin(uv.y * 32.0 - t * 3.0) * 0.003;
    float heatWaveX = snoise(vec2(uv.x * 20.0, uv.y * 15.0 - t * 2.0)) * 0.004;
    vec2 distortedUV = uv + vec2(heatWaveX, heatWaveY);

    // Thermal pin array burn lines (200-300 DPI micro pin lines)
    float pinMicroBands = sin(distortedUV.y * 380.0) * 0.5 + 0.5;
    
    // Thermal head sweep / burn front wave
    float printSweep = mod(t * 0.4, 2.2) - 0.2; // sweeps down the receipt
    float burnFrontDist = abs(uv.y - printSweep);
    float activeBurnGlow = exp(-burnFrontDist * 16.0);
    
    // Ambient residual heat spots (concentrated around printed blocks like total, barcode, and stamps)
    float heatCluster1 = exp(-length((uv - vec2(0.5, 0.72)) * vec2(2.5, 6.0)) * 6.0); // barcode area heat
    float heatCluster2 = exp(-length((uv - vec2(0.65, 0.58)) * vec2(3.0, 5.0)) * 5.0); // total due & paid stamp
    float heatCluster3 = exp(-length((uv - vec2(0.5, 0.28)) * vec2(2.0, 4.0)) * 4.0); // line items
    float residualHeat = (heatCluster1 * 0.7 + heatCluster2 * 0.9 + heatCluster3 * 0.5) * (0.85 + 0.15 * sin(t * 2.0));

    // Combine active burn-in energy
    float totalHeat = clamp(activeBurnGlow * 1.2 + residualHeat * 0.6, 0.0, 1.0);

    // Paper 3D curl height & lighting normal (spool memory curl)
    float spoolCurl = sin(distortedUV.y * 3.14159 * 2.2 + 0.4) * 0.12;
    float foldLine1 = sin(distortedUV.x * 2.8 - distortedUV.y * 1.5 + 0.6);
    float foldCrease1 = exp(-abs(foldLine1) * 12.0) * 0.22;
    float paperWrinkle = snoise(distortedUV * vec2(8.0, 14.0) + vec2(0.5, 0.2)) * 0.06;
    
    // Height & normal calculation
    float height = spoolCurl + foldCrease1 + paperWrinkle;
    vec3 normal = normalize(vec3(-spoolCurl * 0.8 + foldLine1 * 0.2, (distortedUV.y - 0.5) * 0.4, 1.0));

    // Dynamic key light interactive with mouse
    vec2 mouseNorm = u_mouse / u_resolution;
    vec2 lightPos = mix(vec2(0.3, 0.2), mouseNorm, 0.35);
    vec3 lightDir = normalize(vec3(lightPos - distortedUV, 0.6));
    float diff = max(dot(normal, lightDir), 0.0);

    // Celestial color tokens:
    // Thermal burn colors: Radiant amber-gold (#FFB800), hot incandescent core (#FFF4D0), infrared thermal edge (#FF4500)
    vec3 hotCore = vec3(1.0, 0.96, 0.82);
    vec3 celestialGold = vec3(1.0, 0.72, 0.0); // #FFB800
    vec3 infraredFlame = vec3(1.0, 0.26, 0.05); // Thermal heating edge
    vec3 deepCreaseShadow = vec3(0.06, 0.07, 0.09);

    // Color gradient for thermal burn-in
    vec3 thermalGlowColor = mix(infraredFlame, celestialGold, smoothstep(0.15, 0.65, totalHeat));
    thermalGlowColor = mix(thermalGlowColor, hotCore, smoothstep(0.65, 0.95, totalHeat));

    // Thermal pin burn-in scanline modulation
    thermalGlowColor *= (0.8 + 0.25 * pinMicroBands);

    // Specular sheen & heat mirage refraction intensity
    float specular = pow(max(dot(normal, normalize(lightDir + vec3(0.0,0.0,1.0))), 0.0), 16.0);
    
    // Alpha blending and emission:
    // In cold areas, soft paper crease shadows. In hot areas, iridescent thermal emission and heat distortion glow.
    vec4 finalColor;
    if (totalHeat > 0.12) {
        // Active thermal burn-in & heat shimmer emission
        float heatAlpha = smoothstep(0.12, 0.9, totalHeat) * 0.65;
        finalColor = vec4(thermalGlowColor, heatAlpha);
    } else {
        // Subtle paper fold depth shadow & celestial rim specular
        float shadowAlpha = (1.0 - diff) * 0.28 + foldCrease1 * 0.3;
        finalColor = vec4(mix(deepCreaseShadow, celestialGold, specular * 0.25), shadowAlpha);
    }

    // Edge thermal bleed / perimeter vignette
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeHeatLeak = exp(-edgeDist * 40.0) * 0.15 * sin(t * 3.0 + uv.y * 10.0);
    finalColor.rgb += celestialGold * edgeHeatLeak;
    finalColor.a = clamp(finalColor.a + edgeHeatLeak, 0.0, 0.85);

    gl_FragColor = finalColor;
}`;
  function cs(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, cs(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uRes = gl.getUniformLocation(prog, 'u_resolution');
  const uMouse = gl.getUniformLocation(prog, 'u_mouse');

  // u_mouse is in pixel coordinates matching u_resolution (ShaderToy convention).
  // Shaders that need normalized coords should use: u_mouse / u_resolution.
  let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
  window.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width && rect.height) {
      const nx = (event.clientX - rect.left) / rect.width;
      const ny = 1.0 - (event.clientY - rect.top) / rect.height;
      mouse.x = nx * canvas.width;
      mouse.y = ny * canvas.height;
    }
  });

  function render(t) {
    if (typeof ResizeObserver === 'undefined') syncSize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (uTime) gl.uniform1f(uTime, t * 0.001);
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }
  render(0);
return true;
}
