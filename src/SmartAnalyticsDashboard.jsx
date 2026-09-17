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
    
    // States untuk Daftar SKU Terlaris
    const [bestSellerTime, setBestSellerTime] = useState('30days'); 
    const [bestSellerSort, setBestSellerSort] = useState('salesDesc');
    const [expandedArticle, setExpandedArticle] = useState(null);
    
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
    
    // --- BEST SELLERS / TOP SKU LOGIC ---
    const bestSellersData = useMemo(() => {
        if (!inventoryData || inventoryData.length === 0) return [];

        const now = new Date();
        now.setHours(23, 59, 59, 999);
        let startDate = new Date(0); // All time (default)

        if (bestSellerTime === '7days') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            startDate.setHours(0,0,0,0);
        } else if (bestSellerTime === '30days') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
            startDate.setHours(0,0,0,0);
        } else if (bestSellerTime === 'thisMonth') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (bestSellerTime === 'thisYear') {
            startDate = new Date(now.getFullYear(), 0, 1);
        }

        // 1. Calculate sales per SKU within the date range
        const skuSalesMap = {};
        (transactions || []).forEach(tx => {
            if ((tx.type === 'OUT' || tx.type === 'REVISI_OUT') && tx.date) {
                const txDate = new Date(tx.date);
                if (txDate >= startDate && txDate <= now && tx.sku) {
                    skuSalesMap[tx.sku] = (skuSalesMap[tx.sku] || 0) + (Number(tx.qty) || 1);
                }
            }
        });

        // 2. Kalkulasi stok riil (all time)
        const skuStockMap = {};
        (transactions || []).forEach(t => {
            if (!t.sku) return;
            if (t.type === 'IN' || t.type === 'REVISI_IN' || t.type === 'ONLINE_IN' || t.type === 'RETUR_IN') {
                skuStockMap[t.sku] = (skuStockMap[t.sku] || 0) + Number(t.qty || 0);
            } else if (t.type === 'OUT' || t.type === 'REVISI_OUT') {
                skuStockMap[t.sku] = (skuStockMap[t.sku] || 0) - Number(t.qty || 0);
            }
        });

        // 3. Group by Article
        const articleMap = {};
        inventoryData.forEach(item => {
            const articleName = item.article || 'Produk Lainnya';
            if (!articleMap[articleName]) {
                articleMap[articleName] = {
                    article: articleName,
                    totalSales: 0,
                    totalStock: 0,
                    variants: []
                };
            }
            
            const sales = skuSalesMap[item.sku || item.id] || 0;
            const stock = skuStockMap[item.sku || item.id] || 0;
            
            articleMap[articleName].totalSales += sales;
            articleMap[articleName].totalStock += stock;
            
            articleMap[articleName].variants.push({
                ...item,
                sales,
                stock,
                variantName: `${item.colorName || '-'} ${item.sizeName || '-'}`.trim()
            });
        });

        // 4. Convert to array and sort variants inside each article
        const articleArray = Object.values(articleMap).map(art => {
            // Varian di dalam selalu diurutkan berdasarkan yang paling laku
            art.variants.sort((a, b) => b.sales - a.sales); 
            return art;
        });

        // 5. Sort the articles based on selected sort option
        articleArray.sort((a, b) => {
            if (bestSellerSort === 'salesDesc') return b.totalSales - a.totalSales;
            if (bestSellerSort === 'salesAsc') return a.totalSales - b.totalSales;
            if (bestSellerSort === 'stockDesc') return b.totalStock - a.totalStock;
            if (bestSellerSort === 'stockAsc') return a.totalStock - b.totalStock;
            return 0;
        });

        return articleArray;
    }, [inventoryData, transactions, bestSellerTime, bestSellerSort]);


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

            {/* BEST SELLERS / SKU LIST */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden relative">
                <div className="p-4 md:p-6 border-b-2 bg-slate-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <h3 className="text-xl font-black text-rose-800 flex items-center gap-3">
                        <i className="fa-solid fa-ranking-star text-amber-500"></i>
                        Daftar Performa SKU per Artikel
                    </h3>
                    <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                        <select 
                            value={bestSellerTime} 
                            onChange={e => setBestSellerTime(e.target.value)}
                            className="bg-white border-2 border-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl outline-none focus:border-rose-500 text-sm"
                        >
                            <option value="7days">7 Hari Terakhir</option>
                            <option value="30days">30 Hari Terakhir</option>
                            <option value="thisMonth">Bulan Ini</option>
                            <option value="thisYear">Tahun Ini</option>
                            <option value="allTime">Semua Waktu</option>
                        </select>
                        <select 
                            value={bestSellerSort} 
                            onChange={e => setBestSellerSort(e.target.value)}
                            className="bg-white border-2 border-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl outline-none focus:border-rose-500 text-sm"
                        >
                            <option value="salesDesc">Paling Laku (Penjualan)</option>
                            <option value="salesAsc">Kurang Laku (Penjualan)</option>
                            <option value="stockDesc">Stok Terbanyak</option>
                            <option value="stockAsc">Stok Sedikit / Kosong</option>
                        </select>
                    </div>
                </div>
                
                <div className="divide-y divide-slate-100">
                    {bestSellersData.map((art, idx) => (
                        <div key={idx} className="bg-white transition-colors">
                            {/* ARTICLE HEADER (CLICKABLE) */}
                            <div 
                                onClick={() => setExpandedArticle(expandedArticle === art.article ? null : art.article)}
                                className={`p-4 md:p-5 flex items-center justify-between cursor-pointer hover:bg-rose-50 transition-colors ${expandedArticle === art.article ? 'bg-rose-50' : ''}`}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-white ${idx < 3 && bestSellerSort === 'salesDesc' ? 'bg-amber-500 shadow-md shadow-amber-500/30' : 'bg-slate-300'}`}>
                                        {idx + 1}
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-black text-slate-800">{art.article}</h4>
                                        <p className="text-xs font-bold text-slate-400 mt-0.5">{art.variants.length} Varian Produk</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6">
                                    <div className="text-right hidden sm:block">
                                        <div className="text-lg font-black text-emerald-600">{art.totalSales} <span className="text-xs text-emerald-600/70">Terjual</span></div>
                                        <div className="text-xs font-bold text-slate-400 mt-0.5">Sisa Stok: {art.totalStock}</div>
                                    </div>
                                    <i className={`fa-solid fa-chevron-${expandedArticle === art.article ? 'up' : 'down'} text-rose-400 text-lg transition-transform`}></i>
                                </div>
                            </div>
                            
                            {/* EXPANDED VARIANTS */}
                            {expandedArticle === art.article && (
                                <div className="bg-slate-50 p-4 md:p-6 border-t border-rose-100 animate-in fade-in slide-in-from-top-2">
                                    <div className="sm:hidden flex justify-between mb-4 pb-4 border-b border-slate-200">
                                        <div>
                                            <div className="text-xs font-bold text-slate-400">Total Terjual</div>
                                            <div className="text-lg font-black text-emerald-600">{art.totalSales}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs font-bold text-slate-400">Sisa Stok</div>
                                            <div className="text-lg font-black text-slate-700">{art.totalStock}</div>
                                        </div>
                                    </div>
                                    
                                    {(() => {
                                        // Ekstrak ukuran dan warna unik
                                        const sizes = Array.from(new Set(art.variants.map(v => v.sizeName || '-'))).sort((a, b) => {
                                            const numA = parseInt(a);
                                            const numB = parseInt(b);
                                            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                                            return a.localeCompare(b);
                                        });
                                        const colors = Array.from(new Set(art.variants.map(v => v.colorName || '-')));
                                        
                                        const isStockMode = bestSellerSort.startsWith('stock');
                                        const isAsc = bestSellerSort.endsWith('Asc');

                                        // Hitung total per warna untuk sorting baris
                                        const colorTotal = {};
                                        colors.forEach(c => {
                                            colorTotal[c] = art.variants.filter(v => (v.colorName || '-') === c).reduce((sum, v) => sum + (isStockMode ? (parseInt(v.stock) || 0) : v.sales), 0);
                                        });
                                        colors.sort((a, b) => isAsc ? colorTotal[a] - colorTotal[b] : colorTotal[b] - colorTotal[a]);
                                        
                                        // Cari nilai unik untuk ranking juara
                                        let uniqueVals = Array.from(new Set(art.variants.map(v => isStockMode ? (parseInt(v.stock) || 0) : v.sales)));
                                        if (!isStockMode) {
                                            uniqueVals = uniqueVals.filter(val => val > 0); // Abaikan 0 jika mode penjualan
                                        }
                                        uniqueVals.sort((a, b) => isAsc ? a - b : b - a);

                                        return (
                                            <div className="overflow-x-auto bg-white rounded-xl border border-slate-200 shadow-sm">
                                                <table className="w-full text-center border-collapse min-w-max">
                                                    <thead>
                                                        <tr className="bg-rose-50 text-rose-800 text-xs uppercase tracking-wider font-black border-b-2 border-rose-100">
                                                            <th className="p-3 text-left border-r border-rose-100">Warna</th>
                                                            {sizes.map(s => (
                                                                <th key={s} className="p-3 border-r border-rose-100 w-16">{s}</th>
                                                            ))}
                                                            <th className="p-3 bg-rose-100 text-rose-900 w-24">Total</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100 text-sm">
                                                        {colors.map((c, cIdx) => (
                                                            <tr key={cIdx} className="hover:bg-slate-50 transition-colors">
                                                                <td className="p-3 text-left font-bold text-slate-700 border-r border-slate-100">{c}</td>
                                                                {sizes.map(s => {
                                                                    const v = art.variants.find(v => (v.colorName || '-') === c && (v.sizeName || '-') === s);
                                                                    const val = v ? (isStockMode ? (parseInt(v.stock) || 0) : v.sales) : null;
                                                                    const shouldShowBadge = v && (isStockMode ? true : val > 0);
                                                                    
                                                                    let highlightClass = "border-transparent";
                                                                    let badge = null;
                                                                    let textColor = "text-slate-300";

                                                                    if (shouldShowBadge) {
                                                                        const rank = uniqueVals.indexOf(val) + 1;
                                                                        let badgeContent = `#${rank}`;
                                                                        let badgeColor = "bg-slate-700 text-white border-slate-800"; // Default for rank 4+
                                                                        
                                                                        textColor = "text-slate-700"; // Default text color for normal
                                                                        highlightClass = "bg-slate-50 border-slate-200";
                                                                        
                                                                        if (rank === 1) {
                                                                            highlightClass = "bg-rose-50 border-rose-300 shadow-sm";
                                                                            badgeColor = "bg-rose-500 text-white border-rose-600";
                                                                            badgeContent = "👑 1";
                                                                            textColor = "text-rose-700";
                                                                        } else if (rank === 2) {
                                                                            highlightClass = "bg-violet-50 border-violet-300 shadow-sm";
                                                                            badgeColor = "bg-violet-500 text-white border-violet-600";
                                                                            textColor = "text-violet-700";
                                                                        } else if (rank === 3) {
                                                                            highlightClass = "bg-emerald-50 border-emerald-300 shadow-sm";
                                                                            badgeColor = "bg-emerald-500 text-white border-emerald-600";
                                                                            textColor = "text-emerald-700";
                                                                        }

                                                                        badge = (
                                                                            <span className={`absolute -top-2 -right-2 text-[9px] font-black rounded-full px-1.5 py-0.5 shadow-sm border z-10 ${badgeColor}`}>
                                                                                {badgeContent}
                                                                            </span>
                                                                        );
                                                                    }

                                                                    return (
                                                                        <td key={s} className="p-2 border-r border-slate-100">
                                                                            {v ? (
                                                                                <div className={`relative flex items-center justify-center w-full h-full p-2 rounded-md border transition-all ${highlightClass}`}>
                                                                                    {badge}
                                                                                    <div className={`font-bold text-lg ${textColor}`}>
                                                                                        {val}
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <span className="text-slate-200">-</span>
                                                                            )}
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="p-3 bg-rose-50/50 font-black text-rose-700 text-base">
                                                                    {colorTotal[c]}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    ))}
                    {bestSellersData.length === 0 && (
                        <div className="p-8 text-center text-slate-400 font-bold italic">Belum ada data barang atau penjualan.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
