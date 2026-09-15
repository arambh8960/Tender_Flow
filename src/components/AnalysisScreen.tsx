import * as React from 'react';
import { useState, useMemo, useEffect } from 'react';
import { Rfp, AppConfig, BlankDoc, VaultItem } from '../../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  ArrowRight, ShieldCheck, Factory, BrainCircuit, 
  FileCog, Download, CheckCircle2, RefreshCw, 
  MapPin, Scale, Eye,
} from 'lucide-react';
import { rfpApi } from '../services/api';
import { useVault } from '../hooks/useVault';
import { useOrganization } from '../contexts/OrganizationContext';

interface AnalysisScreenProps {
  rfp: Rfp;
  config?: AppConfig; 
  onBack: () => void;
  onCancel: () => void;
  onProceed: (data: any) => void;
}

export const AnalysisScreen: React.FC<AnalysisScreenProps> = ({ rfp, config, onBack, onCancel, onProceed }) => {
  // --- 1. DYNAMIC DATA EXTRACTION ---
  const technicalResults = rfp.agentOutputs?.technicalAnalysis?.itemAnalyses || [];
  const parsedData = rfp.agentOutputs?.parsedData || {};
  const parsedMetadata = parsedData.metadata || {};
  const financialCond = parsedData.financialConditions || {};
  const buyerTerms = parsedData.buyer_added_terms || [];
  const mandatoryDocs = parsedData.mandatoryDocuments || [];
  const companyName = config?.companyDetails?.companyName || "Our Company";
  
  const [documents, setDocuments] = useState<VaultItem[]>([]);
  
  // --- 2. STATE ---
  const [activeTab, setActiveTab] = useState<'COMMERCIALS' | 'COMPLIANCE'>('COMMERCIALS');
  const [logisticsParams, setLogisticsParams] = useState({
    kms: config?.discoveryFilters?.manualAvgKms || 400,
    rate: config?.discoveryFilters?.manualRatePerKm || 55,
    bufferPercent: 10
  });
  const [profitMargin, setProfitMargin] = useState(15);
  const [manualOverrides, setManualOverrides] = useState<Record<string, number>>({});
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [expandedTechItem, setExpandedTechItem] = useState<number | null>(null); 
  const [testingProvision, setTestingProvision] = useState<number>(15000);
  const [disqualifiedItems, setDisqualifiedItems] = useState<string[]>([]);

  // Base docs that must always be checked independently
  const combinedDocs = useMemo(() => {
    const baseDocs = ["GST Certificate", "PAN Card", "Certificate of Incorporation"];
    return Array.from(new Set([...baseDocs, ...mandatoryDocs]));
  }, [mandatoryDocs]);

  // Strict Matching Helper
  const getMatchedVaultDoc = (reqDoc: string, vaultDocs: VaultItem[]) => {
    const reqName = reqDoc.toLowerCase();
    // Exclude generic words to prevent false positives (like Execution Certificate matching GST Certificate)
    const genericWords = ['certificate', 'document', 'declaration', 'form', 'proof', 'copy', 'registration', 'by', 'client', 'for', 'the', 'of'];
    
    return vaultDocs.find(vaultDoc => {
        const vaultName = vaultDoc.cert_name.toLowerCase();
        
        // 1. Direct match
        if (reqName.includes(vaultName) || vaultName.includes(reqName)) return true;

        // 2. Strict Keyword match
        const vaultKeywords = vaultName
            .replace(/[^a-z0-9\s]/g, '')
            .split(' ')
            .filter(w => w.length > 2 && !genericWords.includes(w));
        
        if (vaultKeywords.length === 0) return false;

        // Must match at least one significant identifying keyword
        return vaultKeywords.some(kw => reqName.includes(kw));
    });
  };

  // --- 3. DYNAMIC DOCUMENT GENERATOR ---
  const initialBlankDocs = useMemo(() => {
    const docs: BlankDoc[] = [];
    const smartDocs = parsedData.extractedLinks || [];

    if (smartDocs.length > 0) {
       smartDocs.forEach((doc: { name: string; url: string }, idx: number) => {
          const fullUrl = doc.url.startsWith('http') 
            ? doc.url 
            : `https://bidplus.gem.gov.in${doc.url.startsWith('/') ? '' : '/'}${doc.url}`;
          
          docs.push({
            id: `EXTRACTED_DOC_${idx}`,
            name: doc.name, 
            url: fullUrl,
            status: 'DETECTED',
            type: 'PDF_LINK'
          });
       });
    } else if (technicalResults && technicalResults.length > 0) {
       technicalResults.forEach((item: any, idx: number) => {
          docs.push({
            id: `SKU_SPEC_${idx}`,
            name: `Tech Spec: ${item.rfpLineItem.name.substring(0, 30)}...`,
            url: `https://gem.gov.in/specs/preview/${item.selectedSku?.skuId || 'item'}`,
            status: 'DETECTED',
            type: 'SKU'
          });
       });
    }
    return docs;
  }, [parsedData.extractedLinks, technicalResults]);

  const [blankDocs, setBlankDocs] = useState<BlankDoc[]>(initialBlankDocs);

  // Vault documents for the active organisation, with signed-URL access.
  const { documents: vaultDocuments, openDocument } = useVault();
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  useEffect(() => {
    setDocuments(vaultDocuments);
  }, []);

  useEffect(() => {
    setBlankDocs(initialBlankDocs);
  }, [initialBlankDocs]);

  // --- 4. FINANCIAL CALCULATIONS ---
  const liveCalculations = useMemo(() => {
    let totalMaterialBase = 0;
    let totalGst = 0;

    technicalResults.forEach((analysis: any) => {
      const itemName = analysis.rfpLineItem.name;
      if (disqualifiedItems.includes(itemName)) return; 

      const qty = analysis.rfpLineItem.quantity;
      let unitPrice = manualOverrides[itemName] !== undefined ? manualOverrides[itemName] : (analysis.selectedSku?.unitSalesPrice || 0);
      let gstRate = analysis.selectedSku?.gstRate || 18; 

      totalMaterialBase += (unitPrice * qty);
      totalGst += ((unitPrice * qty) * (gstRate / 100));
    });

    const baseLogistics = logisticsParams.kms * logisticsParams.rate;
    const logisticsWithBuffer = baseLogistics * (1 + (logisticsParams.bufferPercent / 100));
    const testingCost = testingProvision;
    let gemFee = 0;
    if (totalMaterialBase > 1000000 && totalMaterialBase <= 100000000) gemFee = totalMaterialBase * 0.0030;
    else if (totalMaterialBase > 100000000) gemFee = 300000;

    let emd = parsedMetadata.emdAmount || (financialCond?.emd === "Required" ? totalMaterialBase * 0.02 : 0);
    let epbg = parsedMetadata.epbgPercent ? totalMaterialBase * (parsedMetadata.epbgPercent / 100) : (financialCond?.epbg === "Required" ? totalMaterialBase * 0.03 : 0);

    const costBasis = totalMaterialBase + logisticsWithBuffer + testingCost;
    const profitAmount = costBasis * (profitMargin / 100);

    return {
      materialBase: totalMaterialBase,
      gst: totalGst,
      logistics: logisticsWithBuffer,
      gemFee, epbg, emd, profit: profitAmount,
      testing: testingCost,
      finalTotal: totalMaterialBase + totalGst + logisticsWithBuffer + gemFee + epbg + emd + profitAmount + testingCost
    };
  }, [technicalResults, manualOverrides, logisticsParams, profitMargin, parsedMetadata, financialCond, testingProvision, disqualifiedItems]);

  // --- MASTER PDF ENGINE (THE USP - HOLISTIC DOCUMENT) ---
  const generatePremiumPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    
    // 1. Corporate Header
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setTextColor(212, 175, 55);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bolditalic");
    doc.text("TENDERFLOW", 14, 22);
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("INTELLIGENT BID ANALYSIS DOSSIER", 14, 32);

    // 2. Metadata Section
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 50);
    doc.text(`Tender ID: ${parsedMetadata.bidNumber || rfp.id}`, 14, 56);
    doc.text(`Target Department: ${parsedMetadata.department || rfp.organisation.replace('Parsing...', 'GeM Public Tender')}`, 14, 62);
    doc.text(`Consignee Location: ${parsedData.consignee || parsedMetadata.officeName || "Multiple Locations"}`, 14, 68);

    // 3. AI Compliance & Rules Summary
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.text("1. AI Executive Summary & ATC Terms", 14, 85);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    
    let currentY = 92;
    if (buyerTerms && buyerTerms.length > 0) {
      buyerTerms.forEach((term: string, idx: number) => {
        const splitText = doc.splitTextToSize(`${idx + 1}. ${term}`, pageWidth - 28);
        doc.text(splitText, 14, currentY);
        currentY += (splitText.length * 5) + 3;
      });
    } else {
      doc.text("No specific Buyer Added Terms detected by AI.", 14, currentY);
      currentY += 10;
    }

    currentY += 10;

    // 4. Compliance & Vault Readiness
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("2. Document Compliance Validation", 14, currentY);
    
    const complianceData = combinedDocs.map((docName: string) => {
      const matchedDoc = getMatchedVaultDoc(docName, documents);
      const inVault = !!matchedDoc && matchedDoc.is_valid;
      return [docName, inVault ? `Verified: ${matchedDoc.cert_name}` : 'Missing / Required'];
    });

    complianceData.push(['EMD Payment Proof', liveCalculations.emd > 0 ? `Required (₹${Math.round(liveCalculations.emd).toLocaleString()})` : 'Exempted']);

    autoTable(doc, {
      startY: currentY + 5,
      head: [['Required Document', 'System Verification Status']],
      body: complianceData,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] },
      styles: { fontSize: 9 }
    });

    // 5. Technical Match Table
    doc.addPage();
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text("3. Technical Compliance & SKU Matrix", 14, 22);
    
    const techData = technicalResults.map((item: any) => [
      item.rfpLineItem.name,
      item.rfpLineItem.quantity,
      item.selectedSku?.skuId || "N/A",
      disqualifiedItems.includes(item.rfpLineItem.name) ? "DISQUALIFIED" : `${item.selectedSku?.matchPercentage || 0}%`
    ]);

    autoTable(doc, {
      startY: 28,
      head: [['RFP Requirement', 'Qty', 'Matched Internal SKU', 'System Match Score']],
      body: techData,
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { fontSize: 9 }
    });

    // 6. Financial BoQ Table
    const finalY = (doc as any).lastAutoTable.finalY || 90;
    
    if (finalY > 220) {
       doc.addPage();
       currentY = 22;
    } else {
       currentY = finalY + 15;
    }

    doc.setFontSize(14);
    doc.text("4. Financial Bill of Quantities (BoQ)", 14, currentY);

    const finData = [
      ["Base Material Cost (Valid SKUs)", `Rs. ${Math.round(liveCalculations.materialBase).toLocaleString()}`],
      ["Testing & Acceptance Certification", `Rs. ${Math.round(liveCalculations.testing).toLocaleString()}`],
      ["Logistics (Distance + Buffer)", `Rs. ${Math.round(liveCalculations.logistics).toLocaleString()}`],
      ["Total GST Applicable", `Rs. ${Math.round(liveCalculations.gst).toLocaleString()}`],
      ["GeM Platform Brokerage Fee", `Rs. ${Math.round(liveCalculations.gemFee).toLocaleString()}`],
      ["EMD Capital Provision", `Rs. ${Math.round(liveCalculations.emd).toLocaleString()}`],
      ["EPBG Capital Provision", `Rs. ${Math.round(liveCalculations.epbg).toLocaleString()}`],
      [`Net Profit Target (${profitMargin}%)`, `Rs. ${Math.round(liveCalculations.profit).toLocaleString()}`],
      ["FINAL AUTHORIZED BID VALUE", `Rs. ${Math.round(liveCalculations.finalTotal).toLocaleString()}`]
    ];

    autoTable(doc, {
      startY: currentY + 5,
      head: [['Cost Component', 'Calculated Amount (INR)']],
      body: finData,
      theme: 'grid',
      headStyles: { fillColor: [212, 175, 55], textColor: [15, 23, 42] },
      styles: { fontSize: 10 },
      didParseCell: function(data: any) {
        if (data.row.index === finData.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [16, 185, 129];
        }
      }
    });

    return doc;
  };

  const handleDownloadPDF = () => {
    const doc = generatePremiumPDF();
    doc.save(`TenderFlow_Analysis_${parsedMetadata.bidNumber || rfp.id}.pdf`);
  };

  const handleShare = async () => {
    const doc = generatePremiumPDF();
    const pdfBlob = doc.output('blob');
    const file = new File([pdfBlob], `TenderFlow_Analysis_${parsedMetadata.bidNumber || rfp.id}.pdf`, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: `Bid Analysis: ${parsedMetadata.bidNumber || rfp.id}`,
          text: `Here is the finalized AI Bid Analysis. Total Value: ₹${Math.round(liveCalculations.finalTotal).toLocaleString()}`,
          files: [file]
        });
        return;
      } catch (err) {
        console.log('User cancelled share.', err);
      }
    } 
    
    alert("Direct file sharing not supported on this device. The PDF will be downloaded instead.");
    handleDownloadPDF();
  };

  // --- ACTIONS ---
  const handleSaveOverride = (itemName: string, unitPrice: number) => {
    setManualOverrides(prev => ({ ...prev, [itemName]: unitPrice }));
    setEditingItem(null);
  };

  const handleConvertDoc = async (docId: string, url: string, name: string) => {
    setBlankDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'CONVERTING' } : d));

    try {
      if (!organizationId) throw new Error('No active organisation');
      const data = await rfpApi.convertPdf(organizationId, url, name);
      setBlankDocs(prev => prev.map(d =>
        d.id === docId ? { ...d, status: 'CONVERTED_TO_DOCX', docxUrl: data.docxUrl } : d
      ));
    } catch (err) {
      setBlankDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'DETECTED' } : d));
    }
  };

  const handleConvertAll = () => {
    blankDocs.forEach((doc, index) => {
      if (doc.status === 'DETECTED') {
        setTimeout(() => handleConvertDoc(doc.id, doc.url, doc.name), index * 1500);
      }
    });
  };

  // --- 6. RENDERERS ---
  const renderCommercials = () => (
    <div className="flex flex-col gap-6 w-full">
      <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-[2rem] p-6 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <MapPin className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h3 className="text-[13px] font-black text-slate-400 uppercase tracking-widest">Primary Consignee Location</h3>
            <p className="text-[15px] font-bold text-white">
               {(parsedData.consignee || parsedMetadata.officeName || "Multiple Locations")}
            </p>
          </div>
        </div>
        <div className="flex gap-8 text-right">
          <div>
            <label className="text-[10px] uppercase text-slate-400 font-bold block mb-2">Logistics Rate (₹/Km)</label>
            <div className="flex items-center gap-3">
              <input 
                type="range" min="10" max="200" step="5"
                value={logisticsParams.rate} 
                onChange={(e) => setLogisticsParams(prev => ({ ...prev, rate: Number(e.target.value) }))}
                className="w-32 accent-blue-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-sm font-mono text-blue-400 w-12 text-right">₹{logisticsParams.rate}</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 font-bold block mb-2">Distance Buffer (Km)</label>
            <div className="flex items-center gap-3">
              <input 
                type="range" min="0" max="2000" step="10"
                value={logisticsParams.kms} 
                onChange={(e) => setLogisticsParams(prev => ({ ...prev, kms: Number(e.target.value) }))}
                className="w-32 accent-gold-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-sm font-mono text-gold-500 w-12 text-right">{logisticsParams.kms}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 items-start">
        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-[2rem] p-6 flex flex-col shadow-xl">
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest mb-4 flex items-center gap-2">
             <Scale className="w-4 h-4" /> Technical SKU Matching
          </h3>
          <div className="space-y-4">
            {technicalResults.map((analysis: any, idx: number) => {
               const itemName = analysis.rfpLineItem.name;
               const isDisqualified = disqualifiedItems.includes(itemName);
               const isOverridden = manualOverrides[itemName] !== undefined;
               const currentPrice = isOverridden ? manualOverrides[itemName] : (analysis.selectedSku?.unitSalesPrice || 0);

              return (
                  <div key={idx} className={`border p-5 rounded-2xl transition-all ${isDisqualified ? 'bg-red-500/5 border-red-500/30 opacity-70' : isOverridden ? 'bg-gold-500/5 border-gold-500/30' : 'bg-slate-950/80 border-slate-800/80'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="space-y-1">
                        <h4 className="font-bold text-white text-sm uppercase">{itemName}</h4>
                        <div className="flex gap-2 text-[10px] font-bold text-slate-400 uppercase">
                          <span>Req Qty: {analysis.rfpLineItem.quantity} | Spec: {analysis.rfpLineItem.technicalSpecs?.[0] || "Standard"}</span>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setDisqualifiedItems(prev => isDisqualified ? prev.filter(i => i !== itemName) : [...prev, itemName])} 
                          className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${isDisqualified ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-800 text-red-400 hover:bg-red-500/20'}`}
                        >
                          {isDisqualified ? 'Re-Qualify' : 'Disqualify'}
                        </button>
                        {!isDisqualified && (
                          <button onClick={() => setEditingItem(analysis)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-[9px] font-bold text-slate-300 uppercase hover:bg-white hover:text-slate-900 transition-all">
                            {isOverridden ? 'Edit Override' : 'Manual Edit'}
                          </button>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between bg-slate-900/50 p-3 rounded-xl border border-slate-800/50 mt-2">
                      <div className="flex items-center gap-3">
                        <div className="text-emerald-500"><CheckCircle2 className="w-4 h-4" /></div>
                        <div>
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-wider">SKU: {analysis.selectedSku?.skuId || 'No Match'}</p>
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-wider">SKU: {analysis.selectedSku?.productName|| 'No Match'}</p>
                          <p className="text-[9px] text-slate-400 font-bold uppercase">Stock: {analysis.selectedSku?.availableQuantity || 0}</p>
                        </div>
                      </div>
                      <div className="text-right">
                          <p className="text-[9px] text-slate-400 font-black uppercase">Unit Rate</p>
                          <p className={`font-mono text-sm font-bold ${isDisqualified ? 'text-red-500 line-through' : isOverridden ? 'text-gold-500' : 'text-emerald-400'}`}>
                            ₹{isDisqualified ? '0' : currentPrice.toLocaleString()}
                          </p>
                      </div>
                    </div>

                    {!isDisqualified && (
                      <div className="mt-2 text-right">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded bg-slate-900 border ${
                          (analysis.selectedSku?.matchPercentage || 0) > 80 ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30'
                        }`}>
                          Spec Match: {analysis.selectedSku?.matchPercentage || 0}%
                        </span>
                      </div>
                    )}

                    <div className="mt-4 border-t border-slate-800/50 pt-3">
                      <button
                        onClick={() => setExpandedTechItem(expandedTechItem === idx ? null : idx)}
                        className="text-[9px] font-black text-blue-400 uppercase tracking-widest hover:text-white flex items-center gap-1 transition-colors"
                      >
                        {expandedTechItem === idx ? '▼ Hide Comparison Table' : '▶ View Top alternatives'}
                      </button>
                      {expandedTechItem === idx && (
                        <div className="mt-3 bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden animate-in slide-in-from-top-2">
                          <table className="w-full text-left text-[9px]">
                            <thead className="bg-slate-900 text-slate-300 uppercase">
                              <tr>
                                <th className="p-2 pl-4">Rank</th>
                                <th className="p-2">SKU ID</th>
                                <th className="p-2 text-right pr-4">Spec Match</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(analysis.top3Recommendations || []).map((rec: any, rIdx: number) => (
                                <tr key={rIdx} className="border-t border-slate-800/50">
                                  <td className="p-2 pl-4 text-slate-400 font-bold">#{rIdx + 1}</td>
                                  <td className="p-2 text-slate-200">{rec.skuId}</td>
                                  <td className="p-2 text-slate-200">{rec.productName}</td>
                                  <td className="p-2 pr-4 text-right font-bold text-emerald-400">{rec.matchPercentage}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
               );
            })}
          </div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-[2rem] p-8 flex flex-col justify-center relative overflow-hidden shadow-xl sticky top-0">
          <div className="space-y-6 relative z-10">
            <div>
              <label className="text-[10px] uppercase text-slate-300 font-bold block mb-2">Profit Margin (%)</label>
              <input 
                type="range" min="5" max="50" 
                value={profitMargin} 
                onChange={(e) => setProfitMargin(Number(e.target.value))}
                className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
              <div className="text-right mt-1 text-[10px] font-mono text-emerald-400">{profitMargin}% Margin Applied</div>
            </div>

            <div>
              <label className="text-[10px] uppercase text-slate-300 font-bold block mb-2 mt-4">Testing & Certification Provision (₹)</label>
              <input 
                type="range" min="0" max="100000" step="1000"
                value={testingProvision} 
                onChange={(e) => setTestingProvision(Number(e.target.value))}
                className="w-full accent-blue-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
              <div className="text-right mt-1 text-[10px] font-mono text-blue-400">₹{testingProvision.toLocaleString()} Allocated</div>
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-800/80">
              <FinRow label="Total Material Base" value={liveCalculations.materialBase} />
              <FinRow label="Testing & Acceptance Labs" value={liveCalculations.testing} /> 
              <FinRow label="Total GST" value={liveCalculations.gst} />
              <FinRow label="Logistics (w/ Buffer)" value={liveCalculations.logistics} />
              <FinRow label={`Net Profit (${profitMargin}%)`} value={liveCalculations.profit} color="text-emerald-500" />
              <FinRow label="GeM Brokerage" value={liveCalculations.gemFee} />
              <FinRow label={`EMD (${liveCalculations.emd === 0 ? 'Not Reqd' : 'Provision'})`} value={liveCalculations.emd} />
              <FinRow label={`EPBG (${liveCalculations.epbg === 0 ? 'Not Reqd' : 'Provision'})`} value={liveCalculations.epbg} />
            </div>
            
            <div className="h-px bg-slate-800/80 my-4" />
            
            <div className="flex justify-between items-end">
              <div>
                <span className="text-xs font-black uppercase text-gold-500 tracking-widest block">Final Bid Value</span>
                <span className="text-[9px] text-slate-400 uppercase tracking-wider">(Inclusive of Taxes)</span>
              </div>
              <span className="text-4xl font-mono font-bold text-white">₹{Math.round(liveCalculations.finalTotal).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCompliance = () => (
    <div className="flex flex-col gap-6 w-full">
      <div className="grid grid-cols-2 gap-6 items-start w-full">
      {/* LEFT COLUMN */}
      <div className="space-y-6">
        
        {/* Dynamic MII / Local Supplier Benefit Card */}
        {(() => {
          const miiDoc = documents.find((d: VaultItem) => 
            (d.cert_name.toUpperCase().includes('MII') || 
             d.cert_name.toUpperCase().includes('LOCAL CONTENT')) && 
            d.is_valid
          );

          if (!miiDoc) return null;

          return (
            <div className="bg-emerald-500/10 backdrop-blur-md border border-emerald-500/30 rounded-[2rem] p-6 shadow-xl mb-6 animate-in fade-in slide-in-from-left duration-700">
              <div className="flex items-start gap-4">
                <div className="relative">
                  <Factory className="w-8 h-8 text-emerald-500 shrink-0" />
                  <div className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full p-0.5">
                    <CheckCircle2 className="w-2.5 h-2.5 text-slate-950" />
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2">
                    Class-1 Local Supplier Benefit Active
                  </h3>
                  <p className="text-xs text-emerald-100/70 mt-1 leading-relaxed">
                    <strong>Verification Success:</strong> The agent successfully mapped 
                    <span className="text-emerald-400 font-bold mx-1">"{miiDoc.cert_name}"</span> 
                     from your vault to this RFP's MII requirements. 
                    As a Class-1 OEM ({companyName}), you are eligible for the 50% Purchase Preference option.
                  </p>
                  
                  <button 
                    onClick={() => void openDocument(miiDoc.id)}
                    className="mt-3 flex items-center gap-2 text-[10px] font-black text-emerald-500 hover:text-white transition-colors group"
                  >
                    <Eye className="w-3 h-3 group-hover:scale-110 transition-transform" />
                    VIEW MAPPED PROOF
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-[2rem] p-6 shadow-xl">
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Required Docs vs. Vault
          </h3>
          <div className="space-y-3">
             
          {combinedDocs.map((reqDoc: string, i: number) => {
            const matchedVaultDoc = getMatchedVaultDoc(reqDoc, documents);
            const inVault = !!matchedVaultDoc && matchedVaultDoc.is_valid;
            const isOemOverride = inVault && 
              (reqDoc.toLowerCase().includes('oem') || reqDoc.toLowerCase().includes('manufacturer') || reqDoc.toLowerCase().includes('maf')) && 
              matchedVaultDoc.cert_name.toLowerCase().includes('factory');
            return (
                <div key={i} className={`flex justify-between items-center p-4 bg-slate-950/80 rounded-xl border ${inVault ? 'border-emerald-500/20' : 'border-amber-500/20'}`}>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${inVault ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                            {inVault ? <ShieldCheck className="w-4 h-4 text-emerald-500" /> : <FileCog className="w-4 h-4 text-amber-500" />}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-white flex items-center gap-2">
                                {reqDoc}
                                {isOemOverride && (
                                    <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-blue-500/30">
                                        AI Mapped OEM Proof
                                    </span>
                                )}
                            </span>
                            <span className={`text-[9px] font-black uppercase ${inVault ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {inVault ? `Verified: ${matchedVaultDoc.cert_name}` : 'Missing in Vault'}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {inVault && (
                            <button
                                onClick={() => void openDocument(matchedVaultDoc.id)}
                                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-emerald-500 transition-all group"
                                title="View Document"
                            >
                                <Eye className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            </button>
                        )}
                        <span className={`text-[9px] font-black uppercase px-3 py-1.5 rounded-lg ${inVault ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                            {inVault ? 'Matched' : 'Action Required'}
                        </span>
                    </div>
                </div>
            );
          })}
             <div className={`flex justify-between items-center p-4 bg-slate-950/80 rounded-xl border ${liveCalculations.emd > 0 ? 'border-red-500/30' : 'border-slate-800/80'}`}>
               <div>
                 <span className="text-xs font-bold text-white block">EMD Payment Proof</span>
               </div>
               {liveCalculations.emd > 0 ? (
                 <span className="text-[9px] font-black uppercase px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400">Action Required: Pay ₹{Math.round(liveCalculations.emd).toLocaleString()}</span>
               ) : (
                 <span className="text-[9px] font-black uppercase px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400">Exempted by Buyer</span>
               )}
             </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: DOCUMENT EXTRACTION & CONVERSION */}
      <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-[2rem] flex flex-col relative overflow-hidden shadow-xl">
         <div className="p-6 border-b border-slate-800/80 bg-slate-950/50 shrink-0 flex justify-between items-center z-10">
            <div>
               <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-1">
                  <FileCog className="w-5 h-5 text-gold-500" /> 
                  RFP Document Engine
               </h3>
               <p className="text-[9px] text-slate-400 uppercase tracking-wider">
                  {blankDocs.length} Documents extracted
               </p>
            </div>
            
            <div className="flex gap-2">
              <button 
                 onClick={handleConvertAll}
                 className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 shadow-lg"
              >
                 <RefreshCw className="w-3 h-3" /> Process All
              </button>
            </div>
         </div>
         
         <div className="p-6 space-y-4 z-10 overflow-y-auto max-h-[500px]">
            {blankDocs.map((doc: BlankDoc, idx: number) => (
               <div key={idx} className="bg-slate-950/80 border border-slate-800/80 p-5 rounded-2xl flex flex-col gap-4 group">
                  <div className="flex justify-between items-start">
                     <div>
                        <p className="text-xs font-bold text-white">{doc.name}</p>
                        <p className="text-[9px] font-black uppercase text-slate-400 mt-1.5">
                           Status: <span className={doc.status === 'CONVERTED_TO_DOCX' ? 'text-emerald-500' : 'text-amber-500'}>{doc.status.replace(/_/g, ' ')}</span>
                        </p>
                     </div>
                  </div>
                  
                  <div className="flex gap-3 mt-1">
                     <button 
                        onClick={() => {
                          const targetUrl = doc.url;
                          // A placeholder URL means extraction did not find a
                          // real document; opening something else in its place
                          // would present an unrelated file as the source.
                          if (!targetUrl || targetUrl.includes('example.com') || targetUrl.includes('dummy')) {
                            window.alert('No source document was extracted for this item.');
                            return;
                          }
                          window.open(targetUrl, '_blank', 'noopener,noreferrer');
                        }}
                        className="flex-1 py-3 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                     >
                        <Eye className="w-4 h-4" /> Preview
                     </button>
                     
                     {doc.status === 'DETECTED' && (
                        <button 
                           onClick={() => handleConvertDoc(doc.id, doc.url, doc.name)} 
                           className="flex-1 py-3 bg-white text-slate-950 hover:bg-gold-500 hover:text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_5px_20px_rgba(255,255,255,0.2)] flex items-center justify-center gap-2"
                        >
                           <FileCog className="w-4 h-4" /> Convert
                        </button>
                     )}
                     
                     {doc.status === 'CONVERTING' && (
                        <span className="flex-1 py-3 bg-slate-950 border border-slate-800 text-blue-400 text-[9px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 animate-pulse">
                           <RefreshCw className="w-4 h-4 animate-spin" /> Processing
                        </span>
                     )}

                     {doc.status === 'CONVERTED_TO_DOCX' && (
                        <button 
                           onClick={() => { if(doc.docxUrl) window.open(doc.docxUrl, '_blank'); }}
                           className="flex-1 py-3 bg-emerald-500 text-white hover:bg-emerald-400 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_5px_20px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2"
                        >
                           <Download className="w-4 h-4" /> Download
                        </button>
                     )}
                  </div>
               </div>
            ))}
         </div>
      </div>
      </div>
      <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-[2rem] p-6 shadow-xl w-full">
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest mb-6 flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-purple-500" /> Executive AI Summary & ATC Rules
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {buyerTerms.length > 0 ? (
              buyerTerms.map((term: string, idx: number) => (
                <div key={idx} className="flex gap-4 p-4 bg-slate-950/50 rounded-xl border border-slate-800/50">
                  <div className="w-6 h-6 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0">
                    {idx + 1}
                  </div>
                  <span className="text-sm text-slate-200 leading-relaxed font-medium">{term}</span>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-400 italic p-4">No specific Buyer Added Terms detected by AI.</div>
            )}
          </div>
      </div>
    </div>
  );

  return (
      <div className="absolute inset-0 bg-slate-950 text-slate-200 overflow-hidden font-sans flex flex-col">
      <div className="absolute top-[-10%] right-[-10%] w-[800px] h-[800px] bg-gold-500/10 blur-[150px] rounded-full pointer-events-none z-0" />
      <div className="absolute bottom-[20%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 blur-[150px] rounded-full pointer-events-none z-0" />

      <div className="flex-grow w-full overflow-y-auto scrollbar-hide px-8 pt-8 pb-8 relative z-10">
        <div className="shrink-0 flex justify-between items-center mb-8 border-b border-slate-800/80 pb-6">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <button onClick={onBack} className="text-slate-500 hover:text-white transition-colors text-xl font-bold">←</button>
              <h1 className="text-3xl font-black tracking-tighter text-white uppercase italic">
                Bid <span className="text-gold-500">Analysis</span> Console
              </h1>
            </div>
            <div className="flex gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] ml-8">
               <span className="text-gold-500">Bid Number: <span className="text-white">{parsedMetadata.bidNumber || "Draft RFP"}</span></span>
               <span className="text-white bg-slate-800 px-2 py-0.5 rounded">{parsedMetadata.type_of_bid || parsedMetadata.bidType || "Standard Bid"}</span>
            </div>
          </div>
          
          <div className="flex gap-4 items-center">
             <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800/80 px-6 py-2.5 rounded-2xl text-right mr-4 shadow-inner">
                <span className="block text-[8px] text-slate-400 font-black uppercase tracking-widest italic">Live Adjusted Bid</span>
                <span className="text-2xl font-black text-gold-500 drop-shadow-md">₹{Math.round(liveCalculations.finalTotal).toLocaleString()}</span>
             </div>
             
             <button onClick={handleShare} className="bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white px-5 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
               Share 🔗
             </button>
             
             <button onClick={handleDownloadPDF} className="bg-amber-500 text-slate-950 hover:bg-white px-6 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(245,158,11,0.4)]">
               Export PDF
             </button>
          </div>
        </div>

        <div className="flex justify-center gap-4 mb-8 w-full max-w-2xl mx-auto">
          <button 
              onClick={() => setActiveTab('COMMERCIALS')}
              className={`flex-1 px-4 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${activeTab === 'COMMERCIALS' ? 'bg-white text-slate-950 shadow-[0_5px_20px_rgba(255,255,255,0.3)] scale-[1.02]' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'}`}
          >
              Commercials
          </button>
          <button 
              onClick={() => setActiveTab('COMPLIANCE')}
              className={`flex-1 px-4 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${activeTab === 'COMPLIANCE' ? 'bg-white text-slate-950 shadow-[0_5px_20px_rgba(255,255,255,0.3)] scale-[1.02]' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'}`}
          >
              Compliance & Docs
          </button>
        </div>

        <div className="w-full">
           {activeTab === 'COMMERCIALS' && renderCommercials()}
           {activeTab === 'COMPLIANCE' && renderCompliance()}
        </div>
      </div>

      <div className="shrink-0 relative h-24 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between px-8 z-50">
         <button onClick={onCancel} className="bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white px-5 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            Abort Analysis
         </button>
         
        <div className="flex gap-4">
            <button 
                onClick={() => onProceed({
                           blankDocs,
                           liveCalculations,
                           logisticsParams,
                           profitMargin,
                           manualOverrides
                })}
                className="flex items-center justify-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white px-5 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
                Proceed to Final Approval <ArrowRight className="w-4 h-4" />
            </button>
        </div>
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-8">
          <div className="bg-slate-900 border border-slate-800 rounded-[30px] p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-black text-white uppercase italic mb-6">Manual <span className="text-gold-500">Override</span></h2>
            <div className="space-y-4">
               <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Set Manual Unit Rate (₹)</label>
                  <input type="number" autoFocus placeholder="0.00" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-lg text-white outline-none focus:border-gold-500 font-mono mt-2"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveOverride(editingItem.rfpLineItem.name, Number(e.currentTarget.value));
                    }}
                  />
               </div>
               <div className="flex gap-3 mt-6">
                  <button onClick={() => setEditingItem(null)} className="flex-1 py-3 bg-slate-800 text-slate-300 rounded-xl text-[10px] font-black uppercase">Cancel</button>
                  <button onClick={() => {
                    const val = (document.querySelector('input[type="number"]') as HTMLInputElement).value;
                    handleSaveOverride(editingItem.rfpLineItem.name, Number(val));
                  }} className="flex-1 py-3 bg-gold-500 text-slate-950 rounded-xl text-[10px] font-black uppercase hover:bg-white transition-all shadow-lg">Confirm Override</button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FinRow = ({ label, value, color = "text-white" }: { label: string, value: number, color?: string }) => (
  <div className="flex justify-between items-center py-1.5 border-b border-slate-800/50 last:border-0">
    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{label}</span>
    <span className={`font-mono text-xs font-bold ${color}`}>₹{Math.round(value).toLocaleString()}</span>
  </div>
);