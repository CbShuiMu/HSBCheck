import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseStatementPages } from './statements.js';

GlobalWorkerOptions.workerSrc = workerUrl;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 200;

export async function readStatement(file, { sourceId, password, signal, onProgress = () => {} }) {
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 25 MB，请拆分后导入。');
  const data = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  const magic = new TextDecoder('latin1').decode(data.subarray(0, 1024));
  if (!magic.includes('%PDF-')) throw new Error('文件内容不是有效 PDF，请使用银行下载的 PDF 结单。');
  // 指纹只用于本地识别相同文件，不上传原文或摘要。
  const digest = await crypto.subtle.digest('SHA-256', data);
  const fingerprint = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const assetRoot = `${import.meta.env.BASE_URL}pdf-assets/`;
  const task = getDocument({ data, password, cMapUrl: `${assetRoot}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assetRoot}standard_fonts/`, wasmUrl: `${assetRoot}wasm/`, isEvalSupported: false, useSystemFonts: false });
  const abort = () => { void task.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES) throw new Error('结单超过 200 页，请拆分后导入。');
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      onProgress(number, document.numPages);
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      // 将 PDF 左下角坐标转为页面顶部起算，供结单解析器按行列识别。
      pages.push({ page: number, width: viewport.width, height: viewport.height, items: content.items.filter(item => 'str' in item).map(item => ({ text: item.str, x: item.transform[4], y: viewport.height - item.transform[5], width: item.width })) });
      page.cleanup();
    }
    return { ...parseStatementPages(pages, { sourceId, fileName: file.name }), fingerprint };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (error.name === 'PasswordException') {
      const problem = new Error(error.code === PasswordResponses.INCORRECT_PASSWORD ? 'PDF 密码不正确，请重新输入。' : '此 PDF 已加密，请输入结单密码后解析。');
      problem.code = 'password';
      throw problem;
    }
    throw error;
  } finally {
    // 成功、失败和取消都销毁解析任务，释放 Worker 及其文档资源。
    signal?.removeEventListener('abort', abort);
    await task.destroy();
  }
}
