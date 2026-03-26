declare module "html-to-docx" {
  const HTMLtoDOCX: (
    html: string,
    headerFooter?: any,
    options?: any
  ) => Promise<Buffer>;
  export default HTMLtoDOCX;
}







