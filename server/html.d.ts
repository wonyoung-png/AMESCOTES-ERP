// esbuild --loader:.html=text 로 HTML 을 문자열로 묶는다 (대표 콘솔)
declare module '*.html' {
  const html: string;
  export default html;
}
