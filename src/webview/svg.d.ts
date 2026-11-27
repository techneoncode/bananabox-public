/** Browser logos, bundled as data URLs (esbuild `dataurl` loader). */
declare module '*.svg' {
  const url: string;
  export default url;
}
