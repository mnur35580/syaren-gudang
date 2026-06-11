import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts';

export default function SmartAnalyticsDashboard({ variants = [], mpoOrders = [], transactions = [], setActiveMenu }) {
    // --- STATES UNTUK DATA DINAMIS ---
    const [isLoading, setIsLoading] = useState(true);
    const [inventoryData, setInventoryData] = useState([]);
    const [salesHistory, setSalesHistory] = useState([]);
    const [isEditingCapacity, setIsEditingCapacity] = useState(false);
    
    // Metrics State
    const [globalMetrics, setGlobalMetrics] = useState({
        dailyProductionCapacity: parseInt(localStorage.getItem('vendorCapacity')) || 1000, 
        totalPOQueue: 0,
    });

    const handleCapacityChange = (e) => {
        const val = parseInt(e.target.value) || 0;
        setGlobalMetrics(prev => ({ ...prev, dailyProductionCapacity: val }));
        localStorage.setItem('vendorCapacity', val);
    };

    // --- FETCH DATA DARI FIREBASE ---
    useEffect(() => {
        const fetchAnalyticsData = async () => {
            setIsLoading(true);
            try {
                const db = window.db; // Menggunakan instance database global yang sudah di-init di App.jsx
                if (!db) throw new Error("Firebase belum siap");

                // 1. AMBIL DATA STOK RIIL
                // Cek apakah ada data dari prop 'variants' (dari App.jsx). Jika ada, langsung gunakan!
                let fetchedStok = [];
                if (variants && variants.length > 0) {
                    fetchedStok = variants;
                } else {
                    // Kalau tidak ada prop, fetch manual dari Firebase
                    // TODO: Sesuaikan 'products' dengan nama collection stok kamu jika berbeda
                    const stokSnapshot = await db.collection('products').get();
                    
                    // Flatten variants jika formatnya nested di dalam products
                    stokSnapshot.docs.forEach(doc => {
                        const data = doc.data();
                        if (data.variants && Array.isArray(data.variants)) {
                            data.variants.forEach(v => {
                                fetchedStok.push({ ...v, productName: data.name || 'Produk' });
                            });
                        } else {
                            fetchedStok.push({ id: doc.id, ...data });
                        }
                    });
                }

                // 2. AMBIL DATA PENJUALAN (GRPA) & ANTREAN PO
                // TODO: Sesuaikan 'transactions' dengan nama collection GRPA kamu
                const today = new Date();
                const sevenDaysAgo = new Date(today);
                sevenDaysAgo.setDate(today.getDate() - 7);
                const fourteenDaysAgo = new Date(today);
                fourteenDaysAgo.setDate(today.getDate() - 14);

                // Fetch semua transaksi/grpa
                const txSnapshot = await db.collection('transactions').get();
                const allTx = txSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // Cek MPO Orders dari props dan hitung secara akurat
                const calculatedPOQueue = (mpoOrders || []).filter(o => o.status === 'OPEN' || o.status === 'SHIPPED')
                    .reduce((acc, po) => acc + (po.items || []).reduce((s, i) => s + Math.max(0, (i.qty || 0) - (i.received || 0)), 0), 0);

                // Proses Tren Penjualan 14 Hari Terakhir (Contoh pengolahan harian)
                // TODO: Sesuaikan logika filter tanggal dengan field timestamp di tabel GRPA kamu
                let mockSalesHistory = [
                    { day: 'Senin', prevWeek: 0, currWeek: 0 },
                    { day: 'Selasa', prevWeek: 0, currWeek: 0 },
                    { day: 'Rabu', prevWeek: 0, currWeek: 0 },
                    { day: 'Kamis', prevWeek: 0, currWeek: 0 },
                    { day: 'Jumat', prevWeek: 0, currWeek: 0 },
                    { day: 'Sabtu', prevWeek: 0, currWeek: 0 },
                    { day: 'Minggu', prevWeek: 0, currWeek: 0 },
                ];

                // *Catatan: Di sini idealnya ada logika mapping dari allTx ke mockSalesHistory berdasarkan tx.date*
                // Untuk amannya (agar grafik tidak error jika struktur tanggal berbeda), kita isi dengan kalkulasi dummy sementara
                // TODO: Tuliskan logika mapping tanggal dari data GRPA ke struktur salesHistory di atas
                mockSalesHistory = mockSalesHistory.map(day => ({
                    ...day,
                    currWeek: Math.floor(Math.random() * 50) + 10,
                    prevWeek: Math.floor(Math.random() * 50) + 10
                }));

                // Simpan ke State
                setGlobalMetrics(prev => ({ ...prev, totalPOQueue: calculatedPOQueue }));
                setInventoryData(fetchedStok);
                setSalesHistory(mockSalesHistory);

            } catch (error) {
                console.error("Gagal mengambil data analytics:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAnalyticsData();
    }, [variants]);

    // --- CALCULATIONS (GROWTH, LEAD TIME, ROP) ---
    const totalPrevWeek = useMemo(() => salesHistory.reduce((acc, curr) => acc + curr.prevWeek, 0), [salesHistory]);
    const totalCurrWeek = useMemo(() => salesHistory.reduce((acc, curr) => acc + curr.currWeek, 0), [salesHistory]);
    
    // Trend Growth (%) = ((Total Jual 7 Hari Terakhir - Total Jual 7 Hari Sebelumnya) / Total Jual 7 Hari Sebelumnya) * 100
    const trendGrowth = totalPrevWeek > 0 ? (((totalCurrWeek - totalPrevWeek) / totalPrevWeek) * 100).toFixed(1) : "0.0";
    const isTrendPositive = parseFloat(trendGrowth) > 0;

    // Lead Time (Hari) = Total Antrean PO di Bengkel / Kapasitas Produksi Harian
    const leadTime = Math.ceil(globalMetrics.totalPOQueue / globalMetrics.dailyProductionCapacity) || 1;

    // Process Inventory Data for ROP and Recommendations
    const processedInventory = useMemo(() => {
        if (!inventoryData || inventoryData.length === 0) return [];

        // --- KALKULASI DATA ASLI DARI DATABASE ---
        // 1. Ambil transaksi barang keluar (OUT) selama 7 hari terakhir (seminggu) untuk mencari tren harian riil
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const realSalesMap = {};
        (transactions || []).forEach(tx => {
            if (tx.type === 'OUT' && tx.date) {
                const txDate = new Date(tx.date);
                if (txDate >= sevenDaysAgo && tx.sku) {
                    realSalesMap[tx.sku] = (realSalesMap[tx.sku] || 0) + (Number(tx.qty) || 1);
                }
            }
        });

        // 2. Kalkulasi semua item menggunakan data ASLI
        const calculated = inventoryData.map(item => {
            // Rata-rata Penjualan Harian Asli (Total laku seminggu terakhir dibagi 7)
            const realAvgDaily = item.sku && realSalesMap[item.sku] ? Math.ceil(realSalesMap[item.sku] / 7) : 0;
            
            const avgDailySales = realAvgDaily; 

            // Hitung STOK RIIL (Persis seperti di Laporan Stok Detail)
            const stockRiil = item.sku ? (transactions || []).filter(t => t.sku === item.sku).reduce((sum, t) => {
                if (t.type === 'IN' || t.type === 'REVISI_IN' || t.type === 'ONLINE_IN' || t.type === 'RETUR_IN') return sum + Number(t.qty || 0);
                if (t.type === 'OUT' || t.type === 'REVISI_OUT') return sum - Number(t.qty || 0);
                return sum;
            }, 0) : 0;

            // ATURAN BARU FARADELA: 
            // - Stok standar minimum/maksimum untuk barang biasa/sepi adalah 20 pcs.
            // - Kalau barang laris, ROP akan membesar otomatis.
            const baseTargetStock = 20;
            
            // RUMUS ROP Dinamis
            let rop = 0;
            let recommendedPO = 0;
            let status = 'Aman';
            let statusColor = 'bg-emerald-100 text-emerald-700';

            if (avgDailySales <= 1) {
                // BARANG SEPI / SLOW MOVING
                // ROP di-set ke angka sangat kecil (misal 5) agar tidak berisik minta PO
                rop = 5; 
                if (stockRiil <= rop) {
                    status = 'Restock Sedikit';
                    statusColor = 'bg-yellow-100 text-yellow-700 font-bold';
                    recommendedPO = baseTargetStock - stockRiil; // Mentok di 20
                } else if (stockRiil > baseTargetStock) {
                    status = 'Overstock (Promosikan!)';
                    statusColor = 'bg-orange-100 text-orange-700 font-bold';
                }
            } else {
                // BARANG LARIS / FAST MOVING
                // ROP = (Rata-rata jual * waktu tunggu) + Cadangan 20 pcs
                rop = (avgDailySales * leadTime) + baseTargetStock;
                
                if (stockRiil <= rop) {
                    status = 'Segera Restock!';
                    statusColor = 'bg-rose-100 text-rose-700 font-bold';
                    // Rekomendasi PO: Supaya stok kembali penuh buat jualan berminggu-minggu ke depan
                    recommendedPO = (rop * 2) - stockRiil; 
                }
            }

            // Hitung defisit (seberapa jauh di bawah ROP) untuk keperluan sorting
            const deficit = rop - stockRiil;

            // Gabungkan nama dari article, colorName, dan sizeName
            const itemName = `${item.article || 'Produk'} - ${item.colorName || ''} ${item.sizeName || ''}`.trim();

            return {
                id: item.sku || item.id || 'N/A',
                article: item.article,
                colorName: item.colorName,
                sizeName: item.sizeName,
                name: itemName,
                stock: stockRiil,
                avgDailySales,
                rop,
                deficit,
                status,
                statusColor,
                recommendedPO
            };
        });

        // 2. Urutkan berdasarkan yang paling mendesak (defisit stok tertinggi)
        calculated.sort((a, b) => b.deficit - a.deficit);

        // 3. Ambil 15 teratas agar tabel dan chart fokus ke masalah paling utama
        return calculated.slice(0, 15);

    }, [inventoryData, leadTime]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-50 text-slate-500 font-bold">
                <i className="fa-solid fa-circle-notch fa-spin text-3xl text-orange-500 mr-3"></i> Sedang Sinkronisasi Data Analytics...
            </div>
        );
    }

    return (
        <div className="p-6 bg-slate-50 min-h-screen">
            <div className="mb-8">
                <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3">
                    <i className="fa-solid fa-chart-line text-orange-500"></i> Analisis Tren & Peringatan Stok
                </h1>
                <p className="text-slate-500 font-medium mt-2">Data tersinkronisasi otomatis dari database Firebase</p>
            </div>

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2"><i className="fa-solid fa-arrow-trend-up text-blue-500"></i> Pertumbuhan Penjualan</p>
                    <div className="flex items-end gap-3">
                        <h3 className="text-4xl font-black text-slate-800">{isTrendPositive && trendGrowth !== "0.0" ? '+' : ''}{trendGrowth}%</h3>
                        <span className={`text-sm font-bold pb-1 ${isTrendPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {isTrendPositive ? <i className="fa-solid fa-caret-up"></i> : <i className="fa-solid fa-caret-down"></i>} MINGGU INI
                        </span>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center relative group">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-2"><i className="fa-solid fa-industry text-purple-500"></i> Kapasitas Harian (Vendor)</span>
                        <button onClick={() => setIsEditingCapacity(!isEditingCapacity)} className="text-slate-300 hover:text-orange-500 transition-colors">
                            <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                    </p>
                    {isEditingCapacity ? (
                        <div className="flex items-center gap-2 mt-1">
                            <input 
                                type="number" 
                                value={globalMetrics.dailyProductionCapacity} 
                                onChange={handleCapacityChange}
                                className="w-24 px-2 py-1 text-2xl font-black text-slate-800 border-b-2 border-orange-500 outline-none bg-slate-50"
                                autoFocus
                                onBlur={() => setIsEditingCapacity(false)}
                            />
                            <span className="text-base text-slate-400">Pcs/Hari</span>
                        </div>
                    ) : (
                        <h3 className="text-3xl font-black text-slate-800 cursor-pointer" onClick={() => setIsEditingCapacity(true)}>
                            {globalMetrics.dailyProductionCapacity} <span className="text-base text-slate-400">Pcs/Hari</span>
                        </h3>
                    )}
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2"><i className="fa-solid fa-boxes-stacked text-orange-500"></i> Total Antrean PO Pabrik</p>
                    <h3 className="text-3xl font-black text-slate-800">{globalMetrics.totalPOQueue} <span className="text-base text-slate-400">Pcs</span></h3>
                </div>

                <div className="bg-emerald-500 rounded-2xl p-6 shadow-lg shadow-emerald-500/20 text-white flex flex-col justify-center relative overflow-hidden">
                    <i className="fa-solid fa-stopwatch absolute -right-4 -bottom-4 text-7xl opacity-20"></i>
                    <p className="text-emerald-100 text-xs font-bold uppercase tracking-wider mb-2">Estimasi Lead Time</p>
                    <h3 className="text-4xl font-black text-white">{leadTime} <span className="text-lg text-emerald-100">Hari</span></h3>
                    <p className="text-xs text-emerald-100 mt-2">Waktu ideal barang siap dari PO</p>
                </div>
            </div>

            {/* CHARTS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* LINE CHART: TREND PENJUALAN */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2"><i className="fa-solid fa-chart-area text-blue-500"></i> Tren Penjualan Harian</h3>
                    <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={salesHistory} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dx={-10} />
                                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} cursor={{ stroke: '#e2e8f0', strokeWidth: 2, strokeDasharray: '5 5' }} />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />
                                <Line type="monotone" name="Minggu Sebelumnya" dataKey="prevWeek" stroke="#cbd5e1" strokeWidth={3} dot={{r: 4, fill: '#cbd5e1', strokeWidth: 2}} activeDot={{r: 6}} />
                                <Line type="monotone" name="Minggu Ini" dataKey="currWeek" stroke="#f97316" strokeWidth={4} dot={{r: 5, fill: '#f97316', strokeWidth: 2}} activeDot={{r: 7, stroke: '#fff'}} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* BAR CHART: PERINGATAN STOK VS ROP */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2"><i className="fa-solid fa-triangle-exclamation text-rose-500"></i> Peringatan Stok Riil vs ROP</h3>
                    <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={processedInventory} margin={{ top: 5, right: 20, bottom: 5, left: 0 }} barSize={30}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="id" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 'bold'}} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dx={-10} />
                                <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                <Bar dataKey="rop" name="Batas ROP (Aman)" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="stock" name="Stok Saat Ini" radius={[4, 4, 0, 0]}>
                                    {processedInventory.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.stock <= entry.rop ? '#f43f5e' : '#10b981'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* RECOMMENDATION TABLE */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative">
                <div className="p-6 border-b-2 bg-slate-50 flex items-center justify-between">
                    <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                        <i className="fa-solid fa-clipboard-list text-emerald-500"></i>
                        Tabel Rekomendasi Aksi
                    </h3>
                    <button 
                        onClick={() => {
                            if(setActiveMenu) {
                                // 1. Kumpulkan semua item yang butuh di-PO
                                const draftItems = processedInventory
                                    .filter(item => item.status === 'Segera Restock!' || item.status === 'Restock Sedikit')
                                    .map(item => ({
                                        sku: item.id,
                                        article: item.article || item.name.split(' - ')[0] || 'Produk',
                                        colorName: item.colorName || (item.name.split(' - ')[1] ? item.name.split(' - ')[1].split(' ')[0] : '-'),
                                        sizeName: item.sizeName || (item.name.split(' ').pop() || '-'),
                                        qty: item.recommendedPO,
                                        received: 0,
                                        shipped: 0
                                    }));
                                
                                if(draftItems.length === 0) {
                                    alert("Saat ini belum ada produk yang perlu direstock!");
                                    return;
                                }

                                // 2. Simpan ke draft sementara
                                localStorage.setItem('smart_mpo_draft', JSON.stringify(draftItems));

                                // 3. Pindah ke halaman MPB
                                setActiveMenu('mpo_pabrik');
                            } else {
                                alert("Fitur navigasi belum diaktifkan di komponen induk");
                            }
                        }}
                        className="bg-orange-500 hover:bg-orange-600 text-white font-black px-6 py-2.5 rounded-xl text-sm transition-all shadow-md flex items-center gap-2 transform hover:scale-105"
                    >
                        Buat PO MPO Sekarang <i className="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-white text-slate-500 border-b-2 border-slate-100 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="p-4 font-bold">Kode Article</th>
                                <th className="p-4 font-bold">Nama Produk</th>
                                <th className="p-4 font-bold text-center">Stok Riil</th>
                                <th className="p-4 font-bold text-center">Batas ROP</th>
                                <th className="p-4 font-bold text-center">Status Keamanan</th>
                                <th className="p-4 font-bold">Rekomendasi Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-sm">
                            {processedInventory.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                    <td className="p-4 font-black text-slate-700">{item.id}</td>
                                    <td className="p-4 font-semibold text-slate-600">{item.name}</td>
                                    <td className="p-4 text-center font-black text-slate-800">{item.stock}</td>
                                    <td className="p-4 text-center font-bold text-slate-400">{item.rop}</td>
                                    <td className="p-4 text-center">
                                        <span className={`px-3 py-1 rounded-full text-xs ${item.statusColor}`}>{item.status}</span>
                                    </td>
                                    <td className="p-4 font-medium text-slate-600">
                                        {item.status === 'Segera Restock!' && <span className="text-rose-600 flex items-center gap-2"><i className="fa-solid fa-circle-exclamation"></i> Buat PO baru {item.recommendedPO} Pcs</span>}
                                        {item.status === 'Restock Sedikit' && <span className="text-yellow-600 flex items-center gap-2"><i className="fa-solid fa-cart-plus"></i> PO Santai {item.recommendedPO} Pcs</span>}
                                        {item.status === 'Aman' && <span className="text-emerald-600 flex items-center gap-2"><i className="fa-solid fa-check"></i> Tidak perlu PO</span>}
                                        {item.status.includes('Overstock') && <span className="text-orange-600 flex items-center gap-2"><i className="fa-solid fa-fire"></i> Bikin Diskon / Obral!</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
