import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, 
  Search, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  DollarSign, 
  TrendingUp, 
  ArrowUpRight, 
  PlusCircle, 
  Edit2, 
  Layers, 
  Send,
  Download,
  Filter
} from 'lucide-react';
import { api } from '../../services/api.ts';
import { Product } from '../../types.ts';
import { TableToolbar, matchesSearch, exportTableXlsx, isPicked, picked, pickedLabels } from '../common/TableToolbar.tsx';

export const ProductsView: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters (applied on screen to the full list, so every option stays available)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [priceFilter, setPriceFilter] = useState('');

  // Editing state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [purchaseCostInput, setPurchaseCostInput] = useState('');
  const [sellingPriceInput, setSellingPriceInput] = useState('');
  const [minPriceInput, setMinPriceInput] = useState('');
  const [targetSfaSystem, setTargetSfaSystem] = useState<'salesdoc' | 'smartup' | 'linko'>('smartup');

  // New product state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newProductData, setNewProductData] = useState({
    code: '',
    name: '',
    category: '',
    brand: '',
    unit: 'dona',
    purchase_cost: '',
    selling_price: '',
    min_selling_price: ''
  });

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getProducts({});
      setProducts(res.products || []);
    } catch (err: any) {
      setError(err.message || 'Mahsulotlarni yuklashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const distinct = (values: (string | undefined | null)[]) =>
    Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const categories = useMemo(() => distinct(products.map(p => p.category)), [products]);
  const brands = useMemo(() => distinct(products.map(p => p.brand)), [products]);
  const sources = useMemo(() => distinct(products.map(p => p.source)), [products]);

  const visibleProducts = useMemo(() => products.filter(p =>
    matchesSearch(p, searchQuery, ['name', 'code', 'sku', 'category', 'brand']) &&
    isPicked(selectedCategory, p.category) &&
    isPicked(selectedBrand, p.brand) &&
    isPicked(selectedSource, p.source) &&
    (!priceFilter || picked(priceFilter).some(f =>
      (f === 'NO_COST' && !(p.purchase_cost > 0)) ||
      (f === 'NO_PRICE' && !(p.selling_price > 0)) ||
      (f === 'LOSS' && p.purchase_cost > 0 && p.selling_price > 0 && p.selling_price < p.purchase_cost) ||
      (f === 'OK' && p.purchase_cost > 0 && p.selling_price > 0)))
  ), [products, searchQuery, selectedCategory, selectedBrand, selectedSource, priceFilter]);

  // Price types of the distribution system, in the order they first appear (each becomes an Excel column).
  const priceTypeColumns = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; kind: string }>();
    for (const p of products) for (const pr of p.prices || []) if (!seen.has(pr.type_id)) seen.set(pr.type_id, { id: pr.type_id, name: pr.name, kind: pr.kind });
    return Array.from(seen.values());
  }, [products]);

  const priceFilterLabels: Record<string, string> = { OK: 'Narxlari to‘liq', NO_COST: 'Tannarxi yo‘q', NO_PRICE: 'Sotuv narxi yo‘q', LOSS: 'Zararga sotilayotgan' };

  const exportProducts = () => exportTableXlsx({
    fileName: 'Mahsulotlar',
    title: 'Mahsulotlar, narxlar va tannarx',
    columns: [
      { header: 'Kod', key: 'code', width: 14 },
      { header: 'Mahsulot', key: 'name', width: 36 },
      { header: 'Kategoriya', key: 'category', width: 22 },
      { header: 'Brend', key: 'brand', width: 16 },
      { header: 'Birlik', key: 'unit', width: 8 },
      { header: 'Tannarx', key: 'purchase_cost', type: 'money' },
      { header: 'Sotuv narxi', key: 'selling_price', type: 'money' },
      { header: 'Foyda (dona)', key: 'profit', type: 'money' },
      { header: 'Marja', key: 'margin', type: 'percent' },
      { header: 'Ombordagi qoldiq', key: 'stock_quantity', type: 'number', total: true },
      { header: 'Manba', key: 'source', width: 12 },
      ...priceTypeColumns.map(t => ({ header: `${t.name}${t.kind === 'purchase' ? ' (kirim)' : ''}`, key: `price_${t.id}`, type: 'money' as const }))
    ],
    rows: visibleProducts.map(p => {
      const known = p.purchase_cost > 0 && p.selling_price > 0;
      return {
        ...p,
        ...Object.fromEntries((p.prices || []).map(pr => [`price_${pr.type_id}`, pr.price])),
        code: p.code || p.sku,
        purchase_cost: p.purchase_cost || null,
        selling_price: p.selling_price || null,
        profit: known ? p.selling_price - p.purchase_cost : null,
        margin: known ? (p.selling_price - p.purchase_cost) / p.selling_price : null
      };
    }),
    filters: [
      searchQuery && `qidiruv: "${searchQuery}"`,
      selectedCategory && `kategoriya: ${pickedLabels(selectedCategory)}`,
      selectedBrand && `brend: ${pickedLabels(selectedBrand)}`,
      selectedSource && `manba: ${pickedLabels(selectedSource)}`,
      priceFilter && picked(priceFilter).map(f => priceFilterLabels[f]).join(', ')
    ]
  });

  // Handle Edit Price Click
  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setPurchaseCostInput(String(p.purchase_cost || ''));
    setSellingPriceInput(String(p.selling_price || ''));
    setMinPriceInput(String(p.min_selling_price || ''));
  };

  // Save Price Changes & 2-way sync
  const handleSavePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setLoading(true);
    setError(null);

    try {
      const pCost = Number(purchaseCostInput) || 0;
      const sPrice = Number(sellingPriceInput) || 0;
      const mPrice = Number(minPriceInput) || undefined;

      const res = await api.updateProduct(editingProduct.id, {
        purchase_cost: pCost,
        selling_price: sPrice,
        min_selling_price: mPrice
      });

      setSuccessMsg(`"${editingProduct.name}" narxlari yangilandi va SFA tizimiga (${targetSfaSystem}) muvaffaqiyatli sinxronlandi!`);
      setEditingProduct(null);
      fetchProducts();
    } catch (err: any) {
      setError(err.message || 'Narxlarni yangilashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  // Push all prices to external SFA systems
  const handlePushAllPrices = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await api.syncPushPrices(targetSfaSystem);
      setSuccessMsg(res.message || `Barcha narxlar ${targetSfaSystem} tizimiga muvaffaqiyatli uzatildi!`);
    } catch (err: any) {
      setError(err.message || 'Narxlarni sinxronlashda xatolik yuz berdi');
    } finally {
      setSyncing(false);
    }
  };

  // Create Product
  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductData.name || !newProductData.code) {
      setError('Mahsulot nomi va kodi kiritilishi shart');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.createProduct({
        ...newProductData,
        purchase_cost: Number(newProductData.purchase_cost) || 0,
        selling_price: Number(newProductData.selling_price) || 0,
        min_selling_price: Number(newProductData.min_selling_price) || undefined
      });
      setSuccessMsg(`"${newProductData.name}" yangi mahsulot sifatida qo'shildi`);
      setIsAddModalOpen(false);
      setNewProductData({
        code: '',
        name: '',
        category: '',
        brand: '',
        unit: 'dona',
        purchase_cost: '',
        selling_price: '',
        min_selling_price: ''
      });
      fetchProducts();
    } catch (err: any) {
      setError(err.message || 'Mahsulot qo\'shishda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    let totalItems = visibleProducts.length;
    let totalCostVal = 0;
    let totalSaleVal = 0;

    for (const p of visibleProducts) {
      totalCostVal += p.purchase_cost;
      totalSaleVal += p.selling_price;
    }

    const avgMargin = totalSaleVal > 0 ? Math.round(((totalSaleVal - totalCostVal) / totalSaleVal) * 100) : 0;

    return {
      totalItems,
      avgMargin
    };
  }, [visibleProducts]);

  return (
    <div className="space-y-6 pb-12">
      {/* Alert Banners */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 flex items-start justify-between shadow-xs">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start justify-between shadow-xs">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium">{successMsg}</p>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Mahsulotlar, Narxlar va Tannarx</h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Tannarx (COGS), sotuv narxlari, foyda marjasi va SFA tizimlari bilan 2 tomonlama sinxronizatsiya
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Target SFA selector */}
          <div className="flex items-center space-x-2 bg-neutral-50 px-3 py-1.5 rounded-xl border border-neutral-200">
            <span className="text-xs font-semibold text-neutral-600">SFA Tizim:</span>
            <select
              value={targetSfaSystem}
              onChange={e => setTargetSfaSystem(e.target.value as any)}
              className="bg-transparent text-xs font-bold text-indigo-700 focus:outline-none"
            >
              <option value="smartup">smartup.online</option>
              <option value="salesdoc">salesdoc.io</option>
              <option value="linko">linko.uz</option>
            </select>
          </div>

          <button
            onClick={handlePushAllPrices}
            disabled={syncing}
            className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition shadow-xs"
          >
            <Send className={`w-3.5 h-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            Narxlarni SFA ga Yuborish (2-Way Sync)
          </button>

          <button
            onClick={fetchProducts}
            disabled={loading}
            className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Yangilash
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs"
          >
            <PlusCircle className="w-4 h-4 mr-1.5" />
            Yangi Mahsulot
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">Jami Mahsulot Turlari</span>
          <h3 className="text-2xl font-black text-neutral-900 mt-2">{summaryMetrics.totalItems} ta</h3>
          <p className="text-xs text-neutral-400 mt-1">Barcha toifadagi tovarlar</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">O'rtacha Foyda Marjasi</span>
          <h3 className="text-2xl font-black text-emerald-700 mt-2">{summaryMetrics.avgMargin}%</h3>
          <p className="text-xs text-emerald-600/80 mt-1">Sotuv narxi bo'yicha o'rtacha rentabellik</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Integratsiya Holati</span>
          <h3 className="text-lg font-bold text-indigo-900 mt-2">Avtomatik 2 Tomonlama</h3>
          <p className="text-xs text-neutral-400 mt-1">salesdoc.io / smartup.online / linko.uz bilan faol</p>
        </div>
      </div>

      {/* Filter Bar */}
      <TableToolbar
        search={searchQuery}
        onSearch={setSearchQuery}
        searchPlaceholder="Nomi, kodi, kategoriya yoki brend…"
        selects={[
          { label: 'Kategoriya', value: selectedCategory, onChange: setSelectedCategory, allLabel: 'Barcha kategoriyalar', options: categories.map(c => ({ value: c, label: `${c} (${products.filter(p => p.category === c).length})` })) },
          { label: 'Brend', value: selectedBrand, onChange: setSelectedBrand, allLabel: 'Barcha brendlar', options: brands.map(b => ({ value: b, label: b })) },
          { label: 'Manba', value: selectedSource, onChange: setSelectedSource, allLabel: 'Barcha manbalar', options: sources.map(s => ({ value: s, label: s })) },
          { label: 'Narx holati', value: priceFilter, onChange: setPriceFilter, allLabel: 'Narx holati: barchasi', options: Object.entries(priceFilterLabels).map(([value, label]) => ({ value, label })) }
        ]}
        count={visibleProducts.length}
        onReset={() => { setSearchQuery(''); setSelectedCategory(''); setSelectedBrand(''); setSelectedSource(''); setPriceFilter(''); }}
        onExport={exportProducts}
      />

      {/* PRODUCTS TABLE */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                <th className="py-3 px-4">Kodi / SKU</th>
                <th className="py-3 px-4">Mahsulot Nomi</th>
                <th className="py-3 px-4">Kategoriya / Brend</th>
                <th className="py-3 px-4 text-right bg-indigo-50/50">Tan Narxi (Tannarx)</th>
                <th className="py-3 px-4 text-right bg-emerald-50/50">Sotuv Narxi</th>
                <th className="py-3 px-4 text-right">Kutilayotgan Foyda</th>
                <th className="py-3 px-4 text-right">Marja (%)</th>
                {priceTypeColumns.length > 0 && <th className="py-3 px-4">Tizimdagi barcha narxlar</th>}
                <th className="py-3 px-4 text-center">Manba / SFA</th>
                <th className="py-3 px-4 text-center">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 font-medium text-neutral-800">
              {visibleProducts.length === 0 ? (
                <tr>
                  <td colSpan={priceTypeColumns.length > 0 ? 10 : 9} className="py-12 text-center text-neutral-400">
                    {loading ? 'Mahsulotlar yuklanmoqda…' : 'Hech qanday mahsulot topilmadi.'}
                  </td>
                </tr>
              ) : (
                visibleProducts.map(p => {
                  const profit = p.selling_price - p.purchase_cost;
                  const marginPct = p.selling_price > 0 ? Math.round((profit / p.selling_price) * 100) : 0;
                  const isConfigured = p.purchase_cost > 0 && p.selling_price > 0;

                  return (
                    <tr key={p.id} className="hover:bg-neutral-50/70 transition">
                      <td className="py-3 px-4 font-mono text-[11px] text-neutral-600">{p.code}</td>
                      <td className="py-3 px-4 font-bold text-neutral-900">{p.name}</td>
                      <td className="py-3 px-4 text-neutral-500">
                        {p.category || '—'} {p.brand ? `(${p.brand})` : ''}
                      </td>

                      {/* Tan Narxi */}
                      <td className="py-3 px-4 text-right font-bold text-indigo-700 bg-indigo-50/20">
                        {p.purchase_cost > 0 ? (
                          `${p.purchase_cost.toLocaleString()} UZS`
                        ) : (
                          <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-semibold">
                            Qo'yilmagan
                          </span>
                        )}
                      </td>

                      {/* Sotuv Narxi */}
                      <td className="py-3 px-4 text-right font-bold text-emerald-700 bg-emerald-50/20">
                        {p.selling_price > 0 ? (
                          `${p.selling_price.toLocaleString()} UZS`
                        ) : (
                          <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-semibold">
                            Qo'yilmagan
                          </span>
                        )}
                      </td>

                      {/* Foyda */}
                      <td className={`py-3 px-4 text-right font-semibold ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {profit.toLocaleString()} UZS
                      </td>

                      {/* Marja */}
                      <td className="py-3 px-4 text-right font-bold text-neutral-700">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                          marginPct >= 20 ? 'bg-emerald-100 text-emerald-800' : (marginPct > 0 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800')
                        }`}>
                          {marginPct}%
                        </span>
                      </td>

                      {/* All prices of the distribution system, as listed there */}
                      {priceTypeColumns.length > 0 && (
                        <td className="py-2 px-4 text-[11px] text-neutral-600 whitespace-nowrap">
                          {(p.prices || []).length === 0 ? <span className="text-neutral-400">—</span> : (p.prices || []).map(pr => (
                            <div key={pr.type_id} className={pr.kind === 'purchase' ? 'text-indigo-700' : ''}>
                              {pr.name}: <span className="font-semibold">{pr.price.toLocaleString()}</span>
                            </div>
                          ))}
                        </td>
                      )}

                      {/* Manba */}
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-100 text-neutral-700">
                          {p.source || 'SFA Tizimi'}
                        </span>
                      </td>

                      {/* Amal */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleOpenEdit(p)}
                          className="inline-flex items-center px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"
                        >
                          <Edit2 className="w-3 h-3 mr-1" />
                          Narxni Sozlash
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: EDIT PRICE & 2-WAY SYNC */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-100">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900">Narxlarni Belgilash & Sinxronlash</h3>
                  <p className="text-xs text-neutral-500">{editingProduct.name} ({editingProduct.code})</p>
                </div>
              </div>
              <button onClick={() => setEditingProduct(null)} className="text-neutral-400 hover:text-neutral-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePrice} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Tan Narxi (COGS / Tannarx) *
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={purchaseCostInput}
                  onChange={e => setPurchaseCostInput(e.target.value)}
                  placeholder="Masalan: 18000"
                  className="w-full px-3 py-2 text-xs font-bold text-indigo-700 rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[10px] text-neutral-400 mt-1">Keltirilgan tan narx (foydani hisoblashda asos bo'ladi)</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Sotuv Narxi (Selling Price) *
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={sellingPriceInput}
                  onChange={e => setSellingPriceInput(e.target.value)}
                  placeholder="Masalan: 24000"
                  className="w-full px-3 py-2 text-xs font-bold text-emerald-700 rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-[10px] text-neutral-400 mt-1">Mijozlarga taklif etiladigan asosiy sotuv narxi</p>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-600">Kutilayotgan Foyda Marjasi:</span>
                <span className="text-xs font-extrabold text-emerald-700">
                  {Number(sellingPriceInput) > 0 
                    ? `${(Number(sellingPriceInput) - Number(purchaseCostInput)).toLocaleString()} UZS (${Math.round(((Number(sellingPriceInput) - Number(purchaseCostInput)) / Number(sellingPriceInput)) * 100)}%)` 
                    : '0 UZS'}
                </span>
              </div>

              <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                <span className="text-[11px] font-semibold text-indigo-900 block mb-1">
                  2-Tomonlama Integratsiya:
                </span>
                <p className="text-[10px] text-indigo-700">
                  Bu yerda kiritilgan sotuv va tan narxlar avtomatik tarzda integratsiya qilingan <strong>{targetSfaSystem}</strong> tizimiga uzatiladi va narxlar sinxronlashtiriladi.
                </p>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl transition"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs flex items-center"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Saqlash va SFA ga Uzatish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD PRODUCT */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-neutral-100">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
                  <PlusCircle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-neutral-900">Yangi Mahsulot Qo'shish</h3>
              </div>
              <button onClick={() => setIsAddModalOpen(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 mb-1">Mahsulot Kodi *</label>
                  <input
                    type="text"
                    required
                    placeholder="PRD-010"
                    value={newProductData.code}
                    onChange={e => setNewProductData({ ...newProductData, code: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 mb-1">Birlik</label>
                  <input
                    type="text"
                    placeholder="dona, kg, blok"
                    value={newProductData.unit}
                    onChange={e => setNewProductData({ ...newProductData, unit: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Mahsulot Nomi *</label>
                <input
                  type="text"
                  required
                  placeholder="Coca-Cola 1.5L"
                  value={newProductData.name}
                  onChange={e => setNewProductData({ ...newProductData, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 mb-1">Kategoriya</label>
                  <input
                    type="text"
                    placeholder="Ichimliklar"
                    value={newProductData.category}
                    onChange={e => setNewProductData({ ...newProductData, category: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 mb-1">Brend</label>
                  <input
                    type="text"
                    placeholder="Coca-Cola"
                    value={newProductData.brand}
                    onChange={e => setNewProductData({ ...newProductData, brand: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-indigo-700 mb-1">Tan Narxi (COGS)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="12000"
                    value={newProductData.purchase_cost}
                    onChange={e => setNewProductData({ ...newProductData, purchase_cost: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold text-indigo-700 rounded-xl border border-indigo-200 bg-neutral-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-emerald-700 mb-1">Sotuv Narxi</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="15000"
                    value={newProductData.selling_price}
                    onChange={e => setNewProductData({ ...newProductData, selling_price: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold text-emerald-700 rounded-xl border border-emerald-200 bg-neutral-50 focus:bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl transition"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-xs flex items-center"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Mahsulotni Saqlash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
