import { Router } from 'express';
import { businessToday } from '../utils/date.ts';
import type { Request, Response } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.ts';
import { db } from '../db/database.ts';
import type { Product } from '../db/schema.ts';
import { AuditService } from '../services/audit.service.ts';
import { integrationProvider } from '../integrations/provider.ts';
import { SalesDocHistoryService } from '../services/salesdoc-history.service.ts';
import { inventoryObservation } from '../services/inventory-observation.ts';

const router = Router();
router.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    for (const field of ['purchase_cost', 'selling_price', 'stock_quantity']) {
      const value = req.body?.[field];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        res.status(400).json({success: false, error: `${field}: manfiy bo‘lmagan son kerak`}); return;
      }
    }
    for (const field of ['name', 'sku']) {
      if (req.body?.[field] !== undefined && (typeof req.body[field] !== 'string' || !req.body[field].trim() || req.body[field].length > 250)) {
        res.status(400).json({success:false,error:`${field}: to‘g‘ri matn kiriting`}); return;
      }
    }
    if (req.body?.is_active !== undefined && typeof req.body.is_active !== 'boolean') {
      res.status(400).json({success:false,error:'Faollik holati noto‘g‘ri'}); return;
    }
  }
  next();
});

// No automatic fake products seeding - products are imported via integration or created by users

/**
 * GET /api/products - List all products with cost and sale prices
 */
router.get('/', requireAuth, requirePermission('reports', 'view'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;

    const search = (req.query.search as string || '').toLowerCase();
    const category = req.query.category as string;

    let list = db.find('products', p => p.company_id === companyId);
    if (search) {
      list = list.filter(p => p.name.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search));
    }
    if (category) {
      list = list.filter(p => p.category === category);
    }

    res.json({
      success: true,
      products: list.sort((a, b) => a.name.localeCompare(b.name))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/products - Create a new product
 */
router.post('/', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const { sku, name, category, unit, purchase_cost, selling_price, stock_quantity, source } = req.body;

    if (!name || !sku) {
      res.status(400).json({ success: false, error: 'Mahsulot nomi va SKU kodi kiritilishi shart' });
      return;
    }

    const newProd: Product = {
      id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      company_id: companyId,
      sku,
      name,
      category: category || 'Umumiy',
      unit: unit || 'dona',
      purchase_cost: Number(purchase_cost) || 0,
      current_cost: Number(purchase_cost) || 0,
      selling_price: Number(selling_price) || 0,
      stock_quantity: Number(stock_quantity) || 0,
      ...(Number(stock_quantity) > 0 ? { last_in_stock_at: businessToday() } : {}),
      stock_observed_at: businessToday(),
      source: source || 'MANUAL',
      is_active: true,
      created_at: new Date().toISOString()
    };

    db.insert('products', newProd);

    AuditService.log({
      company_id: companyId,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      action: 'CREATE',
      entity: 'Product',
      entity_id: newProd.id,
      old_value: null,
      new_value: newProd,
      reason: 'Yangi mahsulot tan narx va sotuv narxi bilan qo\'shildi'
    });

    res.status(201).json({
      success: true,
      message: 'Mahsulot muvaffaqiyatli saqlandi',
      product: newProd
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/products/:id - Update product (including Cost Price and Sale Price)
 */
router.put('/:id', requireAuth, requirePermission('settings', 'update'), (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const companyId = req.user!.companyId;
    const existing = db.findOne('products', p => p.id === id && p.company_id === companyId);

    if (!existing) {
      res.status(404).json({ success: false, error: 'Mahsulot topilmadi' });
      return;
    }

    const { sku, name, category, unit, purchase_cost, selling_price, stock_quantity, is_active } = req.body;

    const updated = db.update('products', id, {
      ...(sku !== undefined ? { sku } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(purchase_cost !== undefined ? { purchase_cost: Number(purchase_cost), current_cost: Number(purchase_cost) } : {}),
      ...(selling_price !== undefined ? { selling_price: Number(selling_price) } : {}),
      ...(stock_quantity !== undefined ? { stock_quantity: Number(stock_quantity) } : {}),
      ...(stock_quantity !== undefined ? inventoryObservation(existing, Number(stock_quantity), businessToday()) : {}),
      ...(is_active !== undefined ? { is_active } : {}),
      updated_at: new Date().toISOString()
    });

    AuditService.log({
      company_id: companyId,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      action: 'UPDATE',
      entity: 'Product',
      entity_id: id,
      old_value: existing,
      new_value: updated,
      reason: 'Mahsulot narxi (tan narx / sotuv narxi) yangilandi'
    });

    // SalesDoc hides real costs (1 so'm), so costs are entered here; stored orders get the new cost at once.
    if (purchase_cost !== undefined && Number(purchase_cost) !== existing.purchase_cost) {
      SalesDocHistoryService.recomputeCogs(companyId);
    }

    res.json({
      success: true,
      message: 'Mahsulot narxlari muvaffaqiyatli yangilandi',
      product: updated
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/products/sync-push-prices - Push updated prices to integrated SFA (SalesDoc, SmartUp, Linko, 1C)
 * Fulfills: "bu yerda qoyilgan narx integratsiya bolgan dasturga ham otishi kerak"
 */
router.post('/sync-push-prices', requireAuth, requirePermission('settings', 'update'), async (req: Request, res: Response, next) => {
  try {
    const companyId = req.user!.companyId;
    const { provider_name, product_ids } = req.body;

    let targetProducts = db.find('products', p => p.company_id === companyId && p.is_active);
    if (product_ids && Array.isArray(product_ids) && product_ids.length > 0) {
      targetProducts = targetProducts.filter(p => product_ids.includes(p.id));
    }

    const syncProviderName = provider_name || 'SALESDOC';
    const adapter = integrationProvider.getAdapter(syncProviderName);

    // Call adapter to push prices to the external API
    const pushResult = await adapter.exportData(
      {
        companyId,
        startDate: businessToday(),
        endDate: businessToday(),
        type: 'PRICE_UPDATE' as any,
        data: targetProducts.map(p => ({
          sku: p.sku,
          name: p.name,
          cost_price: p.purchase_cost,
          selling_price: p.selling_price
        }))
      },
      {}
    );

    AuditService.log({
      company_id: companyId,
      user_id: req.user!.userId,
      user_email: req.user!.email,
      action: 'SYNC',
      entity: 'ProductPriceSync',
      entity_id: syncProviderName,
      old_value: null,
      new_value: { pushedCount: targetProducts.length, provider: syncProviderName },
      reason: `Mahsulot tan narxlari va sotuv narxlari ${syncProviderName} tizimiga muvaffaqiyatli uzatildi (2-Way Push)`
    });

    res.json({
      success: true,
      message: `${targetProducts.length} ta mahsulotning tan narxi va sotuv narxi ${syncProviderName} tizimiga muvaffaqiyatli uzatildi!`,
      pushedCount: targetProducts.length,
      provider: syncProviderName,
      details: pushResult
    });
  } catch (err) {
    next(err);
  }
});

export default router;
