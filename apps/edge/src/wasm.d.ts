// wrangler は `import x from './foo.wasm'` を WebAssembly.Module として解決する。
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
