declare module "html-docx-js" {
  const htmlDocx: {
    asBlob: (html: string) => Blob | Buffer;
    asHTML: (html: string) => string;
  };
  export default htmlDocx;
}
