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

        const [timeFilter, setTimeFilter] = useState("Mingguan");
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    
    // Generate array of years (from 2020 to current year + 1)
    const availableYears = useMemo(() => {
        const currentY = new Date().getFullYear();
        return Array.from({ length: currentY - 2020 + 2 }, (_, i) => 2020 + i);
    }, []);
    
    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    useEffect(() => {
        setIsLoading(true);
        const calculatedPOQueue = (mpoOrders || []).filter(o => o.status === "OPEN" || o.status === "SHIPPED")
            .reduce((acc, po) => acc + (po.items || []).reduce((s, i) => s + Math.max(0, (i.qty || 0) - (i.received || 0)), 0), 0);
        setGlobalMetrics(prev => ({ ...prev, totalPOQueue: calculatedPOQueue }));
        setInventoryData(variants);
        setIsLoading(false);
    }, [variants, mpoOrders]);

    // --- CALCULATIONS (GROWTH, LEAD TIME, ROP) ---
    const chartData = useMemo(() => {
        if (!transactions || transactions.length === 0) return [];
        
        const now = new Date();
        const data = [];
        
        const getMonday = (d) => {
          const dt = new Date(d);
          const day = dt.getDay(), diff = dt.getDate() - day + (day === 0 ? -6 : 1);
          return new Date(dt.setDate(diff));
        };

        if (timeFilter === "Mingguan") {
            const days = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
            const currMonday = getMonday(now);
            currMonday.setHours(0,0,0,0);
            
            const prevMonday = new Date(currMonday);
            prevMonday.setDate(prevMonday.getDate() - 7);
            
            days.forEach((day) => data.push({ label: day, prev: 0, curr: 0 }));

            transactions.forEach(tx => {
                if (tx.type !== "OUT" && tx.type !== "REVISI_OUT" || !tx.date) return;
                const txDate = new Date(tx.date);
                const dayIndex = txDate.getDay() === 0 ? 6 : txDate.getDay() - 1;
                
                if (txDate >= currMonday) {
                    const diffDays = Math.floor((txDate - currMonday) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 0 && diffDays < 7) {
                        data[dayIndex].curr += Number(tx.qty || 0);
                    }
                } else if (txDate >= prevMonday && txDate < currMonday) {
                    const diffDays = Math.floor((txDate - prevMonday) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 0 && diffDays < 7) {
                        data[dayIndex].prev += Number(tx.qty || 0);
                    }
                }
            });
            return data;
        }

        if (timeFilter === "Bulanan") {
            const currYear = selectedYear;
            const currMonth = selectedMonth;
            const prevMonthDate = new Date(currYear, currMonth - 1, 1);
            const prevMonth = prevMonthDate.getMonth();
            const prevMonthYear = prevMonthDate.getFullYear();

            const daysInCurrMonth = new Date(currYear, currMonth + 1, 0).getDate();
            const daysInPrevMonth = new Date(prevMonthYear, prevMonth + 1, 0).getDate();
            const maxDays = Math.max(daysInCurrMonth, daysInPrevMonth);

            for (let i = 1; i <= maxDays; i++) {
                data.push({ label: i.toString(), prev: 0, curr: 0 });
            }

            transactions.forEach(tx => {
                if (tx.type !== "OUT" && tx.type !== "REVISI_OUT" || !tx.date) return;
                const txDate = new Date(tx.date);
                const dateNum = txDate.getDate();

                if (txDate.getFullYear() === currYear && txDate.getMonth() === currMonth) {
                    data[dateNum - 1].curr += Number(tx.qty || 0);
                } else if (txDate.getFullYear() === prevMonthYear && txDate.getMonth() === prevMonth) {
                    data[dateNum - 1].prev += Number(tx.qty || 0);
                }
            });
            return data;
        }

        if (timeFilter === "Tahunan") {
            const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
            const currYear = selectedYear;
            const prevYear = currYear - 1;

            months.forEach(m => data.push({ label: m, prev: 0, curr: 0 }));

            transactions.forEach(tx => {
                if (tx.type !== "OUT" && tx.type !== "REVISI_OUT" || !tx.date) return;
                const txDate = new Date(tx.date);
                const monthIndex = txDate.getMonth();

                if (txDate.getFullYear() === currYear) {
                    data[monthIndex].curr += Number(tx.qty || 0);
                } else if (txDate.getFullYear() === prevYear) {
                    data[monthIndex].prev += Number(tx.qty || 0);
                }
            });
            return data;
        }

        return [];
    }, [transactions, timeFilter]);

    const totalPrevPeriod = useMemo(() => chartData.reduce((acc, curr) => acc + curr.prev, 0), [chartData]);
    const totalCurrPeriod = useMemo(() => chartData.reduce((acc, curr) => acc + curr.curr, 0), [chartData]);
    
    // Trend Growth (%)
    const trendGrowth = totalPrevPeriod > 0 ? (((totalCurrPeriod - totalPrevPeriod) / totalPrevPeriod) * 100).toFixed(1) : "0.0";
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

            // ATURAN BARU SYAREN: 
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
                    statusColor = 'bg-rose-100 text-rose-700 font-bold';
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
                <i className="fa-solid fa-circle-notch fa-spin text-3xl text-rose-500 mr-3"></i> Sedang Sinkronisasi Data Analytics...
            </div>
        );
    }

    return (

        
        <div className="p-6 bg-slate-50 min-h-screen">
            <div className="mb-8">
                <h1 className="text-3xl font-black text-rose-800 flex items-center gap-3">
                    <i className="fa-solid fa-chart-line text-rose-500"></i> Analisis Tren & Peringatan Stok
                </h1>
                <p className="text-slate-500 font-medium mt-2">Data tersinkronisasi otomatis dari database Firebase</p>

                
            </div>

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2"><i className="fa-solid fa-arrow-trend-up text-blue-500"></i> Pertumbuhan Penjualan</p>
                    <div className="flex items-end gap-3">
                        <h3 className="text-4xl font-black text-rose-800">{isTrendPositive && trendGrowth !== "0.0" ? '+' : ''}{trendGrowth}%</h3>
                        <span className={`text-sm font-bold pb-1 ${isTrendPositive ? "text-emerald-500" : "text-rose-500"}`}>
                            {isTrendPositive ? <i className="fa-solid fa-caret-up"></i> : <i className="fa-solid fa-caret-down"></i>} {timeFilter === "Mingguan" ? "MINGGU INI" : timeFilter === "Bulanan" ? "BULAN INI" : "TAHUN INI"}
                        </span>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center relative group">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-2"><i className="fa-solid fa-industry text-purple-500"></i> Kapasitas Harian (Vendor)</span>
                        <button onClick={() => setIsEditingCapacity(!isEditingCapacity)} className="text-slate-300 hover:text-rose-500 transition-colors">
                            <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                    </p>
                    {isEditingCapacity ? (
                        <div className="flex items-center gap-2 mt-1">
                            <input 
                                type="number" 
                                value={globalMetrics.dailyProductionCapacity} 
                                onChange={handleCapacityChange}
                                className="w-24 px-2 py-1 text-2xl font-black text-rose-800 border-b-2 border-rose-500 outline-none bg-slate-50"
                                autoFocus
                                onBlur={() => setIsEditingCapacity(false)}
                            />
                            <span className="text-base text-slate-400">Pcs/Hari</span>
                        </div>
                    ) : (
                        <h3 className="text-3xl font-black text-rose-800 cursor-pointer" onClick={() => setIsEditingCapacity(true)}>
                            {globalMetrics.dailyProductionCapacity} <span className="text-base text-slate-400">Pcs/Hari</span>
                        </h3>
                    )}
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center">
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2"><i className="fa-solid fa-boxes-stacked text-rose-500"></i> Total Antrean PO Pabrik</p>
                    <h3 className="text-3xl font-black text-rose-800">{globalMetrics.totalPOQueue} <span className="text-base text-slate-400">Pcs</span></h3>
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
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                        <h3 className="text-lg font-black text-rose-800 flex items-center gap-2">
                            <i className="fa-solid fa-chart-area text-blue-500"></i> Tren Penjualan
                        </h3>
                        <div className="flex items-center gap-3">
                            {timeFilter === "Bulanan" && (
                                <select 
                                    value={selectedMonth} 
                                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                    className="px-2 py-1.5 text-xs font-bold rounded-md bg-white border border-slate-200 text-slate-600 outline-none focus:border-blue-500"
                                >
                                    {monthNames.map((m, i) => <option key={i} value={i}>{m}</option>)}
                                </select>
                            )}
                            {(timeFilter === "Bulanan" || timeFilter === "Tahunan") && (
                                <select 
                                    value={selectedYear} 
                                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                                    className="px-2 py-1.5 text-xs font-bold rounded-md bg-white border border-slate-200 text-slate-600 outline-none focus:border-blue-500"
                                >
                                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            )}
                            <div className="flex bg-rose-50 p-1 rounded-lg">
                            {["Mingguan", "Bulanan", "Tahunan"].map(tf => (
                                <button 
                                    key={tf}
                                    onClick={() => setTimeFilter(tf)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${timeFilter === tf ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                    <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill: "#94a3b8", fontSize: 12}} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: "#94a3b8", fontSize: 12}} dx={-10} />
                                <RechartsTooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }} cursor={{ stroke: "#e2e8f0", strokeWidth: 2, strokeDasharray: "5 5" }} />
                                <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="circle" />
                                <Line type="monotone" name={timeFilter === "Mingguan" ? "Minggu Sebelumnya" : timeFilter === "Bulanan" ? "Bulan Sebelumnya" : "Tahun Sebelumnya"} dataKey="prev" stroke="#cbd5e1" strokeWidth={3} dot={{r: 4, fill: "#cbd5e1", strokeWidth: 2}} activeDot={{r: 6}} />
                                <Line type="monotone" name={timeFilter === "Mingguan" ? "Minggu Ini" : timeFilter === "Bulanan" ? "Bulan Ini" : "Tahun Ini"} dataKey="curr" stroke="#f97316" strokeWidth={4} dot={{r: 5, fill: "#f97316", strokeWidth: 2}} activeDot={{r: 7, stroke: "#fff"}} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* BAR CHART: PERINGATAN STOK VS ROP */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <h3 className="text-lg font-black text-rose-800 mb-6 flex items-center gap-2"><i className="fa-solid fa-triangle-exclamation text-rose-500"></i> Peringatan Stok Riil vs ROP</h3>
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
                    <h3 className="text-xl font-black text-rose-800 flex items-center gap-3">
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
                        className="bg-rose-500 hover:bg-rose-600 text-white font-black px-6 py-2.5 rounded-xl text-sm transition-all shadow-md flex items-center gap-2 transform hover:scale-105"
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
                                    <td className="p-4 text-center font-black text-rose-800">{item.stock}</td>
                                    <td className="p-4 text-center font-bold text-slate-400">{item.rop}</td>
                                    <td className="p-4 text-center">
                                        <span className={`px-3 py-1 rounded-full text-xs ${item.statusColor}`}>{item.status}</span>
                                    </td>
                                    <td className="p-4 font-medium text-slate-600">
                                        {item.status === 'Segera Restock!' && <span className="text-rose-600 flex items-center gap-2"><i className="fa-solid fa-circle-exclamation"></i> Buat PO baru {item.recommendedPO} Pcs</span>}
                                        {item.status === 'Restock Sedikit' && <span className="text-yellow-600 flex items-center gap-2"><i className="fa-solid fa-cart-plus"></i> PO Santai {item.recommendedPO} Pcs</span>}
                                        {item.status === 'Aman' && <span className="text-emerald-600 flex items-center gap-2"><i className="fa-solid fa-check"></i> Tidak perlu PO</span>}
                                        {item.status.includes('Overstock') && <span className="text-rose-600 flex items-center gap-2"><i className="fa-solid fa-fire"></i> Bikin Diskon / Obral!</span>}
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
