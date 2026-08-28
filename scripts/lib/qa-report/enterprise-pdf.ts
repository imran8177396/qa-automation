import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

export async function writeEnterprisePdf(htmlPath: string, pdfPath: string): Promise<string> {
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '16mm',
        right: '12mm',
        bottom: '16mm',
        left: '12mm',
      },
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="font-size:8px; width:100%; text-align:right; color:#64748b; padding-right:12mm;">QA Test Execution Report</div>',
      footerTemplate:
        '<div style="font-size:8px; width:100%; text-align:center; color:#64748b;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}
