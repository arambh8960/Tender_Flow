import * as React from 'react';
import { useState, useMemo, useRef } from 'react';
import { SKU } from '../../types';
import { AddItemModal } from './AddItemModal';
import { Trash2, FileSpreadsheet, Plus, Search, Maximize2, X } from 'lucide-react';

interface StoreScreenProps {
  inventory: SKU[];
  setInventory: React.Dispatch<React.SetStateAction<SKU[]>>;
}

const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export const StoreScreen: React.FC<StoreScreenProps> = ({ inventory, setInventory }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SKU | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');
  const [isExpanded, setIsExpanded] = useState(false); 
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredInventory = useMemo(() => {
    return inventory.filter(sku => 
      sku.productName.toLowerCase().includes(searchTerm.toLowerCase()) || 
      sku.skuId.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [inventory, searchTerm]);

  // --- Handlers ---
  const handleOpenAdd = () => {
    setEditingItem(undefined); 
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: SKU) => {
    setEditingItem(item); 
    setIsModalOpen(true);
  };

  const handleSaveItem = (item: SKU) => {
    setInventory(prev => {
      const exists = prev.find(i => i.skuId === item.skuId);
      if (exists) return prev.map(i => i.skuId === item.skuId ? item : i);
      return [item, ...prev];
    });
    setIsModalOpen(false);
  };

  const handleDeleteAll = () => {
    const confirm = window.confirm("⚠️ WARNING: This will permanently delete your entire Master Inventory. Are you absolutely sure?");
    if (confirm) {
      setInventory([]);
      alert("Inventory has been completely cleared.");
    }
  };

  // --- CSV Engine ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split('\n').filter(l => l.trim() !== '');
      if (lines.length < 2) return alert("Invalid CSV format. Need headers and data.");

      // Row index makes a generated code unique within the batch; a random
      // 3-digit suffix could collide and silently merge two imported rows.
      const importedAt = Date.now();
      const newSkus: SKU[] = lines.slice(1).map((line, rowIndex) => {
        const values = line.split(',').map(v => v.trim());
        const price = parseFloat(values[4]) || 0;
        
        return {
          skuId: values[0] || `SKU-${importedAt}-${rowIndex + 1}`,
          productName: values[1] || 'Imported Product',
          productCategory: values[2] || 'Imported Category',
          productSubCategory: 'General',
          oemBrand: 'Internal',
          specification: {},
          availableQuantity: parseInt(values[3]) || 0,
          warehouseLocation: "Jalandhar, PB",
          warehouseCode: "JAL-01",
          warehouseLat: 31.3260,
          warehouseLon: 75.5762,
          truckType: 'LCV',
          leadTime: 3,
          costPrice: price * 0.8,
          unitSalesPrice: price,
          bulkSalesPrice: price * 0.9,
          gstRate: 18,
          minMarginPercent: 10,
          isActive: true,
          isCustomMadePossible: false,
          isComplianceReady: true,
        };
      });

      setInventory(prev => [...newSkus, ...prev]);
      alert(`Successfully imported ${newSkus.length} new SKUs from CSV!`);
      if (fileInputRef.current) fileInputRef.current.value = ''; // Reset input
    };
    reader.readAsText(file);
  };

  return (
    // P14: Fixed the wrapper so it aggressively covers the whole screen when expanded
    <div className={`flex flex-col bg-slate-900/40 border border-slate-800 rounded-3xl backdrop-blur-xl shadow-2xl overflow-hidden transition-all duration-500 ease-in-out ${isExpanded ? 'fixed inset-0 z-[999] bg-slate-950 p-8 rounded-none border-none' : 'h-full w-full'}`}>
      
      {/* HEADER */}
      <div className={`shrink-0 border-b border-slate-800 flex justify-between items-center bg-slate-900/60 ${isExpanded ? 'p-8 rounded-t-3xl' : 'p-6'}`}>
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase drop-shadow-md">
            Master<span className="text-gold-500"> Inventory  </span>
            <span className="px-2.5 py-1 bg-blue-500/10 text-blue-400 text-[10px] uppercase tracking-widest rounded-md border border-blue-500/20 ml-2">
              Live DB
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">Manage SKUs, Pricing, and Stock Availability</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search SKUs..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none focus:border-blue-500 transition-colors w-64"
            />
          </div>
          
          <input 
            type="file" 
            accept=".csv, .txt" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            className="hidden" 
          />
          
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> Import CSV
          </button>

          <button onClick={handleOpenAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/20 transition-all">
            <Plus className="w-4 h-4" /> Add Item
          </button>

          {/* NEW: Improved Expand Button */}
          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              isExpanded 
                ? 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700' 
                : 'bg-slate-200 text-slate-900 hover:text-white hover:bg-slate-700'
            }`}
          >
            {isExpanded ? <><X className="w-4 h-4" /> Close Fullscreen</> : <><Maximize2 className="w-4 h-4" /> Expand View</>}
          </button>
        </div>
      </div>

      {/* TABLE BODY */}
      <div className={`flex-grow overflow-auto scrollbar-hide bg-slate-900/40 ${isExpanded ? 'p-8' : 'p-6'}`}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-300">
              <th className="pb-3 pl-4">SKU ID</th>
              <th className="pb-3">Product Description</th>
              <th className="pb-3">Category</th>
              
              {/* DYNAMIC COLUMNS REVEALED ON EXPAND */}
              {isExpanded && (
                <>
                  <th className="pb-3 text-right">Cost Price</th>
                  <th className="pb-3 text-center">GST Rate</th>
                  <th className="pb-3 text-center">Min Margin</th>
                </>
              )}
              
              <th className="pb-3 text-right">Available Stock</th>
              <th className="pb-3 text-right">Unit Price</th>
              <th className="pb-3 text-center pr-4">Actions</th>
            </tr>
          </thead>
          <tbody className="text-xs">
            {filteredInventory.map((sku, idx) => (
              <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group">
                <td className="py-4 pl-4 font-mono text-blue-400 font-bold">{sku.skuId}</td>
                <td className="py-4 font-medium text-slate-200 pr-4">{sku.productName}</td>
                <td className="py-4 text-slate-400">{sku.productCategory}</td>
                
                {/* DYNAMIC DATA REVEALED ON EXPAND */}
                {isExpanded && (
                  <>
                    <td className="py-4 text-right font-mono text-slate-400">{currencyFormatter.format(sku.costPrice)}</td>
                    <td className="py-4 text-center font-mono text-slate-400">{sku.gstRate}%</td>
                    <td className="py-4 text-center font-mono text-emerald-500">{sku.minMarginPercent}%</td>
                  </>
                )}

                <td className="py-4 text-right">
                  <span className={`px-2 py-1 rounded-md font-bold ${sku.availableQuantity > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                    {sku.availableQuantity} Units
                  </span>
                </td>
                <td className="py-4 text-right font-mono font-bold text-slate-300">{currencyFormatter.format(sku.unitSalesPrice)}</td>
                <td className="py-4 pr-4">
                  <div className="flex justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleOpenEdit(sku)} className="text-slate-500 hover:text-blue-400 transition-colors">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <button onClick={() => setInventory(prev => prev.filter(i => i.skuId !== sku.skuId))} className="text-slate-500 hover:text-red-500 transition-colors">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* FOOTER */}
      <div className={`shrink-0 border-t border-slate-800 bg-slate-900/60 flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em] text-slate-200 ${isExpanded ? 'p-8 rounded-b-3xl' : 'p-4'}`}>
        <div>Total Master Items: <span className="text-white">{filteredInventory.length}</span></div>
        <div>TenderFlow PIM System Active</div>
        <button onClick={handleDeleteAll} className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500 hover:text-white text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            <Trash2 className="w-4 h-4" /> Delete All
          </button>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <AddItemModal 
          onClose={() => setIsModalOpen(false)} 
          onSave={handleSaveItem} 
          existingItem={editingItem}
        />
      )}
    </div>
  );
};