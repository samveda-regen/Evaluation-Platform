declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.css' {
  const styles: Record<string, string>;
  export default styles;
}
