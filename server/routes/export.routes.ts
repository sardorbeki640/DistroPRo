import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { db } from '../db/database.ts';
import { buildXlsx, xlsxDisposition, XLSX_MIME } from '../utils/xlsx.ts';

const router = Router();

const ColumnSchema = z.object({
  header: z.string().max(80),
  key: z.string().max(60),
  type: z.enum(['text', 'money', 'number', 'percent', 'date']).optional(),
  width: z.number().min(3).max(80).optional(),
  total: z.boolean().optional()
});
const SheetSchema = z.object({
  name: z.string().max(60),
  title: z.string().max(200),
  subtitle: z.array(z.string().max(300)).max(6).optional(),
  columns: z.array(ColumnSchema).min(1).max(40),
  rows: z.array(z.record(z.string(), z.unknown())).max(50000),
  totalsLabel: z.string().max(40).optional(),
  summary: z.array(z.object({ label: z.string().max(120), value: z.unknown(), type: z.enum(['text', 'money', 'number', 'percent', 'date']).optional() })).max(30).optional()
});
const ExportSchema = z.object({ fileName: z.string().max(120), sheets: z.array(SheetSchema).min(1).max(12) });

/**
 * POST /api/exports/xlsx - formats a table the user is looking at (already filtered by the screen and the user's rights)
 * as a styled .xlsx. The company name and the time are added on the server.
 */
router.post('/xlsx', requireAuth, (req: Request, res: Response, next) => {
  try {
    const body = ExportSchema.parse(req.body);
    const company = db.findById('companies', req.user!.companyId);
    const stamp = `Tayyorlandi: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}`;
    const sheets = body.sheets.map(s => ({ ...s, subtitle: [company?.name || '', ...(s.subtitle || []), stamp].filter(Boolean) }));
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', xlsxDisposition(body.fileName.replace(/[\\/:*?"<>|]/g, '_')));
    res.send(buildXlsx(sheets));
  } catch (err) {
    next(err);
  }
});

export default router;
