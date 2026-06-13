import React, { useState, useEffect, useMemo, useRef } from 'react';
import SmartAnalyticsDashboard from './SmartAnalyticsDashboard';

// ==========================================
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAluumW49cXW9r4JNhWlX8mWVXWNiwj7rc",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "faradela-management.firebaseapp.com",
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://faradela-management-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "faradela-management",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "faradela-management.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "669980441237",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:669980441237:web:c99f979ba9039b9972b99c"
};

// Pastikan semua library CDN terhubung dengan aman di mode Vite
const firebase = window.firebase;
const XLSX = window.XLSX;
const PDFLib = window.PDFLib;
const pdfjsLib = window.pdfjsLib;
let db;
let storage;
try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    window.db = db; // EXPOSE TO WINDOW FOR MODULE CONTEXT
    storage = firebase.storage();
    window.storage = storage;
    
    // --- SISIPKAN KODE INI ---
    db.enablePersistence({ synchronizeTabs: true })
        .catch((err) => {
            if (err.code === 'failed-precondition') console.log("Persistence failed: multiple tabs open");
            else if (err.code === 'unimplemented') console.log("Persistence not supported");
        });
} catch (error) {
    console.error("Firebase initialization error", error);
}

// ===

// --- HELPER UNTUK BARCODE PENDEK (SHORTCODE) ---
const buildShortBarcode = (variant, printDate, type, sessionOrPo) => {
    if (!variant || !variant.shortCode) {
        // Fallback ke legacy jika belum ada shortcode
        const dateSuffix = printDate ? printDate.replace(/-/g, '') : '';
        if (type === 'ONLINE') return `${variant.sku}${dateSuffix}*${sessionOrPo}`;
        if (type === 'PO') return `${variant.sku}${dateSuffix}#${sessionOrPo}`;
        return `${variant.sku}${dateSuffix}`;
    }
    
    // Format Baru: Dengan Tanggal Terbaca (DDMMYY)
    let dateStr = '';
    if (printDate) {
        const parts = printDate.split('T')[0].split('-');
        if (parts.length === 3) {
            dateStr = `-${parts[2]}${parts[1]}${parts[0].slice(-2)}`;
        }
    }

    if (type === 'ONLINE') return `$${variant.shortCode}${dateStr}*${sessionOrPo}`;
    if (type === 'PO') {
        const poBase36 = parseInt(sessionOrPo, 10).toString(36).toLowerCase();
        return `$${variant.shortCode}${dateStr}#${poBase36}`;
    }
    return `$${variant.shortCode}${dateStr}`;
};

const parseGlobalSku = (raw, providedVariants = null) => {
    let text = raw.trim().toUpperCase();
    if (text.startsWith('$')) {
        // Barcode baru: $XXXX*1 (tanpa strip)
        const mainPart = text.substring(1);
        // ShortCode selalu 4 karakter PERTAMA!
        const shortCode = mainPart.substring(0, 4);
        const sourceVariants = providedVariants || window.globalVariants || [];
        const v = sourceVariants.find(v => v.shortCode === shortCode);
        return v ? v.sku : shortCode;
    }
    // Legacy parsing
    let sku = text;
    if (sku.includes('#')) { let s = sku.split('#')[0]; if (s.length > 8 && !isNaN(s.slice(-8))) s = s.slice(0, -8); return s; }
    if (sku.includes('*')) { let s = sku.split('*')[0]; if (s.length > 8 && !isNaN(s.slice(-8))) s = s.slice(0, -8); return s; }
    if (sku.length > 8 && !isNaN(sku.slice(-8))) return sku.slice(0, -8);
    return sku;
};

const detectGlobalBarcodeType = (raw) => {
    const t = raw.trim().toUpperCase();
    if (t.includes('#')) return 'PO';
    if (t.includes('*')) return 'ONLINE';
    return 'UNKNOWN';
};

// --- AUDIO & TEXT-TO-SPEECH ---
let lastAudioPlay = 0;
const playAudioSafe = (id) => {
    const now = Date.now();
    if (now - lastAudioPlay < 150) return;
    lastAudioPlay = now;
    try {
        const audioEl = document.getElementById(id);
        if (audioEl) {
            audioEl.currentTime = 0;
            audioEl.play().catch(() => { });
        }
    } catch (e) { }
};

const playSuccess = () => playAudioSafe('audio-success');
const playError = () => playAudioSafe('audio-error');   // Tetot!
const playConfirm = () => playAudioSafe('audio-confirm');
// Cekling = suara ding dua nada via Web Audio API (tidak butuh file lokal)
const playCekling = () => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gainNode = ctx.createGain();
        gainNode.connect(ctx.destination);
        // Nada 1: 880 Hz
        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, ctx.currentTime);
        osc1.connect(gainNode);
        gainNode.gain.setValueAtTime(0.7, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc1.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.25);
        // Nada 2: 1200 Hz (lebih tinggi, muncul 0.15 detik kemudian)
        const gainNode2 = ctx.createGain();
        gainNode2.connect(ctx.destination);
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1200, ctx.currentTime + 0.15);
        osc2.connect(gainNode2);
        gainNode2.gain.setValueAtTime(0, ctx.currentTime + 0.15);
        gainNode2.gain.setValueAtTime(0.8, ctx.currentTime + 0.16);
        gainNode2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc2.start(ctx.currentTime + 0.15);
        osc2.stop(ctx.currentTime + 0.5);
    } catch (e) { }
};

const playTTS = (text) => {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Hentikan antrean suara sebelumnya
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'id-ID';
        utterance.rate = 1.1; // Sedikit dicepatkan
        utterance.pitch = 1.2; // Suara robot wanita
        window.speechSynthesis.speak(utterance);
    }
};

const formatRp = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka || 0);

// --- GLOBAL UTILITY: Parsing Artikel agar urutannya RAPI & SAMA di semua menu ---
const parseArticleForSortGlobal = (articleName) => {
    let num = 0, group = 0;
    const parts = articleName.split('-');
    const prefix = parts[0] || ""; // Bagian depan: 2F01, F01, F07, dll
    if (parts.length > 1) {
        const codePart = parts.slice(1).join('-');
        const dotParts = codePart.split('.');
        num = parseInt(dotParts[0], 10) || 0; // Angka sebelum titik: 04, 05, 06
        if (dotParts.length > 1) {
            group = parseInt(dotParts[1], 10) || 0; // Angka setelah titik: 1, 2 (untuk F07-06.1)
        }
    }
    return { prefix, num, group };
};

// --- KOMPONEN LOKAL BARCODE & QRCODE ---
function Barcode({ value }) {
    const svgRef = useRef(null);
    useEffect(() => {
        if (svgRef.current && window.JsBarcode) {
            window.JsBarcode(svgRef.current, value, {
                format: "CODE128", width: 2, height: 55, displayValue: false, margin: 0, fontSize: 14
            });
        }
    }, [value]);
    return <svg ref={svgRef} style={{ maxHeight: '100%', maxWidth: '100%' }}></svg>;
}

function QRCodeLocal({ value }) {
    const qrcodeRef = useRef(null);
    useEffect(() => {
        if (qrcodeRef.current && window.QRCode) {
            qrcodeRef.current.innerHTML = "";
            new window.QRCode(qrcodeRef.current, {
                text: value, width: 70, height: 70, colorDark: "#000000", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.L
            });
        }
    }, [value]);
    return <div ref={qrcodeRef}></div>;
}

// --- DAFTAR MENU (DIURUTKAN SESUAI PERMINTAAN BARU) ---

const ALL_MENUS = [
    { id: 'dashboard', label: 'Dashboard Utama', icon: 'fa-chart-simple' },
    { id: 'smart_analytics', label: 'Smart Analytics & ROP', icon: 'fa-chart-line' },
    { id: 'karyawan', label: 'Data Karyawan', icon: 'fa-id-card' },
    { id: 'upload_produk', label: 'Master Produk', icon: 'fa-box-open' },
    { id: 'mpo_pabrik', label: 'Manajemen PO Bengkel (MPB)', icon: 'fa-industry' },
    { id: 'grpa', label: 'Generator Rekapan (GRPA)', icon: 'fa-server' },

    // ---> INI IKON QC YANG SUDAH DIPERBAIKI (Pasti Muncul) <---
    { id: 'qc_packing', label: 'QC & Packing', icon: 'fa-boxes-stacked' },

    { id: 'pesanan_manual', label: 'Resi Manual', icon: 'fa-envelope-open-text' },

    { id: 'handover_kurir', label: 'Handover Kurir', icon: 'fa-truck-fast' },
    { id: 'cetak_label', label: 'Cetak Label', icon: 'fa-tags' },
    { id: 'barang_masuk', label: 'Scan Masuk', icon: 'fa-right-to-bracket' },
    { id: 'barang_keluar', label: 'Scan Keluar', icon: 'fa-right-from-bracket' },
    { id: 'revisi_stok', label: 'Revisi Stok / Tukar', icon: 'fa-right-left' },
    { id: 'stok_opname', label: 'Stok Opname', icon: 'fa-clipboard-check' },
    // SEBELUMNYA: { id: 'cek_surat_jalan', label: 'Surat Jalan Digital', icon: 'fa-file-pen' },
    { id: 'cek_surat_jalan', label: 'Produksi Bengkel', icon: 'fa-industry' },
    { id: 'kas_operasional', label: 'Kas Operasional', icon: 'fa-wallet' },
    { id: 'laporan_stok', label: 'Laporan Stok Detail', icon: 'fa-table-list' },
    { id: 'pantau_stok', label: 'Pantau Umur Stok', icon: 'fa-eye' },
    { id: 'pengaturan', label: 'Pengaturan & Akun', icon: 'fa-users-gear', adminOnly: true }
];

// --- KOMPONEN UTAMA ---
function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [isAuthChecking, setIsAuthChecking] = useState(true); // <-- BARIS BARU INI
    const [activeMenu, setActiveMenu] = useState('dashboard');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState(null);
    const toastTimeoutRef = useRef(null);

    const [products, setProducts] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [qcOrders, setQcOrders] = useState([]); // State untuk antrean QC
    const [mpoOrders, setMpoOrders] = useState([]); // State untuk PO Pabrik
    const [onlineDrafts, setOnlineDrafts] = useState([]); // State untuk Antrean Online
    const [manualOrders, setManualOrders] = useState([]); // State untuk Pesanan Manual
    const [senderTemplates, setSenderTemplates] = useState([]); // State untuk Template Pengirim
    const [dbError, setDbError] = useState(false);

    // ==========================================
    // FITUR: AUTO LOGIN & 6 JAM INACTIVITY
    // ==========================================
    useEffect(() => {
        const INACTIVITY_LIMIT = 6 * 60 * 60 * 1000; // 6 Jam
        let activityTimeout;

        const unsubscribe = firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                const lastActivity = localStorage.getItem('faradela_lastActivity');
                const now = Date.now();

                if (lastActivity && (now - parseInt(lastActivity, 10) > INACTIVITY_LIMIT)) {
                    await firebase.auth().signOut();
                    setCurrentUser(null);
                    localStorage.removeItem('faradela_lastActivity');
                    setIsAuthChecking(false);
                    return;
                }

                const username = user.email.split('@')[0];
                try {
                    const snap = await db.collection('users').where('username', '==', username).get();
                    if (!snap.empty) {
                        setCurrentUser({ id: snap.docs[0].id, ...snap.docs[0].data() });
                        localStorage.setItem('faradela_lastActivity', Date.now().toString());
                    } else if (username === 'mindela') {
                        const adminSnap = await db.collection('users').doc('mindela').get();
                        if (adminSnap.exists) setCurrentUser({ id: adminSnap.id, ...adminSnap.data() });
                    }
                } catch (e) { console.error(e); }
            } else {
                setCurrentUser(null);
            }
            setIsAuthChecking(false);
        });

        const updateActivity = () => {
            if (firebase.auth().currentUser && !activityTimeout) {
                localStorage.setItem('faradela_lastActivity', Date.now().toString());
                activityTimeout = setTimeout(() => { activityTimeout = null; }, 60000);
            }
        };

        window.addEventListener('mousemove', updateActivity);
        window.addEventListener('keydown', updateActivity);
        window.addEventListener('click', updateActivity);
        window.addEventListener('touchstart', updateActivity);

        return () => {
            unsubscribe();
            window.removeEventListener('mousemove', updateActivity);
            window.removeEventListener('keydown', updateActivity);
            window.removeEventListener('click', updateActivity);
            window.removeEventListener('touchstart', updateActivity);
        };
    }, []);
    // ==========================================

    useEffect(() => {
        if (!currentUser || !db) return;
        const unsubProducts = db.collection('products').onSnapshot(snap => setProducts(snap.docs.map(doc => doc.data())), err => setDbError(true));
        const unsubTx = db.collection('transactions').onSnapshot(snap => {
            const txData = snap.docs.map(doc => doc.data());
            txData.sort((a, b) => new Date(a.date) - new Date(b.date));
            setTransactions(txData);
        }, err => setDbError(true));

        const unsubQc = db.collection('qc_orders').onSnapshot(snap => {
            setQcOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, err => console.log(err));

        const unsubMpo = db.collection('purchase_orders').onSnapshot(snap => {
            setMpoOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, err => console.log(err));

        const unsubOnline = db.collection('po_drafts').onSnapshot(snap => {
            setOnlineDrafts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, err => console.log(err));

        const unsubManual = db.collection('manual_orders').onSnapshot(snap => {
            setManualOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, err => console.log(err));

        const unsubSenders = db.collection('manual_order_senders').onSnapshot(snap => {
            setSenderTemplates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, err => console.log(err));

        return () => { unsubProducts(); unsubTx(); unsubQc(); unsubMpo(); unsubOnline(); unsubManual(); unsubSenders(); };
    }, [currentUser]);
    // --- SKRIP MIGRASI SHORTCODE OTOMATIS ---
    useEffect(() => {
        if (products.length > 0 && window.db) {
            let usedCodes = new Set();
            let updatesNeeded = false;
            
            // Kumpulkan semua kode yang sudah dipakai
            products.forEach(p => {
                if (p.shortCodes) Object.values(p.shortCodes).forEach(code => usedCodes.add(code));
            });

            const generateCode = () => {
                const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                let code;
                do {
                    code = '';
                    for(let i=0; i<4; i++) code += chars[Math.floor(Math.random() * chars.length)];
                } while (usedCodes.has(code));
                usedCodes.add(code);
                return code;
            };

            const chunkArray = (arr, size) => arr.length ? [arr.slice(0, size), ...chunkArray(arr.slice(size), size)] : [];
            const productChunks = chunkArray(products, 300);

            let hasUpdates = false;

            const processChunks = async () => {
                try {
                    for (const chunk of productChunks) {
                        const batch = window.db.batch();
                        let batchHasUpdates = false;

                        chunk.forEach(p => {
                            let pShortCodes = p.shortCodes ? { ...p.shortCodes } : {};
                            let changed = false;

                            (p.colors || []).forEach(c => {
                                (p.sizes || []).forEach(s => {
                                    const key = `${c.code}${s.code}`;
                                    if (!pShortCodes[key]) {
                                        pShortCodes[key] = generateCode();
                                        changed = true;
                                    }
                                });
                            });

                            if (changed) {
                                batchHasUpdates = true;
                                hasUpdates = true;
                                batch.update(window.db.collection('products').doc(p.id), { shortCodes: pShortCodes });
                            }
                        });

                        if (batchHasUpdates) {
                            await batch.commit();
                        }
                    }
                    if (hasUpdates) {
                        console.log('✅ ShortCodes berhasil digenerate dan disimpan (chunked)!');
                    }
                } catch (err) {
                    console.error('❌ Gagal memigrasi shortCodes:', err);
                }
            };

            processChunks();
        }
    }, [products]);

    // --- SKRIP RESCUE SHORTCODES SEMENTARA ---
    // Skrip ini memulihkan 1000+ kode barcode pendek yang sempat dicetak namun gagal tersimpan kemarin
    useEffect(() => {
        if (products.length > 0 && transactions.length > 0 && window.db && !localStorage.getItem('shortcode_rescued_v2')) {
            const rescueCodes = async () => {
                let updatesCount = 0;
                let foundMappings = {}; // sku -> shortCode

                // 1. Ekstrak mapping dari transactions
                transactions.forEach(t => {
                    if (t.fullBarcode && t.fullBarcode.startsWith('$') && t.sku && t.sku.length > 4) {
                        const sc = t.fullBarcode.substring(1, 5);
                        // Pastikan t.sku BUKAN fallbackSku (contoh: bukan "BDWH")
                        if (t.sku !== sc && t.sku.length > 5) {
                            foundMappings[t.sku] = sc;
                        }
                    }
                });

                if (Object.keys(foundMappings).length === 0) {
                    localStorage.setItem('shortcode_rescued_v2', 'true');
                    return;
                }

                console.log("Mencoba memulihkan shortcodes dari riwayat transaksi...");

                // 2. Terapkan ke products (secara berurutan / chunk)
                const chunkArray = (arr, size) => arr.length ? [arr.slice(0, size), ...chunkArray(arr.slice(size), size)] : [];
                const productChunks = chunkArray(products, 300);

                for (const chunk of productChunks) {
                    const batch = window.db.batch();
                    let batchHasUpdates = false;

                    chunk.forEach(p => {
                        let pShortCodes = p.shortCodes ? { ...p.shortCodes } : {};
                        let changed = false;

                        (p.colors || []).forEach(c => {
                            (p.sizes || []).forEach(s => {
                                const sku = `${p.baseCode}${c.code}${s.code}`;
                                if (foundMappings[sku] && pShortCodes[`${c.code}${s.code}`] !== foundMappings[sku]) {
                                    pShortCodes[`${c.code}${s.code}`] = foundMappings[sku];
                                    changed = true;
                                }
                            });
                        });

                        if (changed) {
                            batch.update(window.db.collection('products').doc(p.id), { shortCodes: pShortCodes });
                            batchHasUpdates = true;
                            updatesCount++;
                        }
                    });

                    if (batchHasUpdates) {
                        await batch.commit();
                    }
                }

                console.log(`Berhasil memulihkan ${updatesCount} produk!`);
                localStorage.setItem('shortcode_rescued_v2', 'true');
                if (updatesCount > 0 && typeof showToast === 'function') {
                    // showToast belum terdefinisi di scope App ini karena showToast dibuat di dalam fungsi App?
                    // Tunggu, showToast adalah state!
                }
            };
            rescueCodes();
        }
    }, [products, transactions]);

    const allVariants = useMemo(() => {
        let variants = [];
        products.forEach(p => {
            (p.colors || []).forEach((c, cIdx) => {
                (p.sizes || []).forEach((s, sIdx) => {
                    const key = `${c.code}${s.code}`;
                    const sc = p.shortCodes && p.shortCodes[key] ? p.shortCodes[key] : null;
                    variants.push({
                        productId: p.id, article: p.article, baseCode: p.baseCode, photo: p.photo,
                        /* LOGIKA BARU: Pakai harga Size jika ada, kalau kosong pakai Harga Utama */
                        buyPrice: (s.buyPrice !== undefined && s.buyPrice !== '') ? Number(s.buyPrice) : (p.buyPrice || 0),
                        sellPrice: (s.sellPrice !== undefined && s.sellPrice !== '') ? Number(s.sellPrice) : (p.sellPrice || 0),
                        isActive: p.isActive,
                        colorName: c.name, colorCode: c.code, sizeName: s.name, sizeCode: s.code,
                        sku: `${p.baseCode}${c.code}${s.code}`,
                        colorIndex: cIdx, sizeIndex: sIdx,
                        shortCode: sc
                    });
                });
            });
        });
        return variants;
    }, [products]);

    useEffect(() => {
        window.globalVariants = allVariants;
    }, [allVariants]);

    const showToast = (type, message) => {
        setToast({ type, message });
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);
    };

    if (isAuthChecking) return <div className="flex h-screen items-center justify-center bg-slate-900 text-orange-500 font-black text-2xl"><i className="fa-solid fa-circle-notch fa-spin mr-3"></i> Memeriksa Sesi...</div>;
    if (dbError) return <div className="p-8 text-center text-red-600 font-bold">Koneksi Database Gagal. Cek Aturan Firebase.</div>;
    if (!currentUser) return <LoginPage onLogin={(userObj) => {
        localStorage.setItem('faradela_lastActivity', Date.now().toString());
        setCurrentUser(userObj);
    }} />;

    const allowedMenus = ALL_MENUS.filter(m => {
        if (m.adminOnly && currentUser.role !== 'admin') return false;
        if (currentUser.role === 'admin') return true;

        // Khusus Produksi Bengkel, munculkan menunya jika punya salah satu dari 3 akses ini
        if (m.id === 'cek_surat_jalan') {
            return (currentUser.access || []).includes('sj_lery') ||
                (currentUser.access || []).includes('sj_samin') ||
                (currentUser.access || []).includes('sj_faradela');
        }

        return (currentUser.access || []).includes(m.id);
    });

    // Jika menu saat ini tidak ada di daftar izin, buka menu pertama yang diizinkan
    if (!allowedMenus.find(m => m.id === activeMenu)) {
        if (allowedMenus.length > 0) setActiveMenu(allowedMenus[0].id);
    }

    const handleMenuClick = (menuId) => {
        setActiveMenu(menuId);
        setIsMobileMenuOpen(false);
    };

    const renderContent = () => {
        switch (activeMenu) {
            case 'dashboard': return <Dashboard transactions={transactions} qcOrders={qcOrders} mpoOrders={mpoOrders} variants={allVariants} />;
            case 'smart_analytics': return <SmartAnalyticsDashboard variants={allVariants} mpoOrders={mpoOrders} transactions={transactions} setActiveMenu={setActiveMenu} />;
            case 'karyawan': return <ManajemenKaryawan setIsLoading={setIsLoading} showToast={showToast} />;
            case 'upload_produk': return <UploadProduk products={products} setIsLoading={setIsLoading} showToast={showToast} />;
            case 'cetak_label': return <CetakLabel products={products} variants={allVariants} showToast={showToast} />;
            case 'barang_masuk': return <TransaksiScan key="masuk" type="IN" variants={allVariants} transactions={transactions} setIsLoading={setIsLoading} showToast={showToast} currentUser={currentUser} />;
            case 'barang_keluar': return <TransaksiScan key="keluar" type="OUT" variants={allVariants} transactions={transactions} setIsLoading={setIsLoading} showToast={showToast} currentUser={currentUser} />;
            case 'revisi_stok': return <RevisiStok variants={allVariants} transactions={transactions} setIsLoading={setIsLoading} showToast={showToast} currentUser={currentUser} />;
            case 'grpa': return <GeneratorRekapanAHD variants={allVariants} transactions={transactions} manualOrders={manualOrders} setIsLoading={setIsLoading} showToast={showToast} currentUser={currentUser} />;
            case 'pesanan_manual': return <PesananManual variants={allVariants} manualOrders={manualOrders} senderTemplates={senderTemplates} transactions={transactions} showToast={showToast} setIsLoading={setIsLoading} currentUser={currentUser} />;
            case 'qc_packing': return <QcPacking variants={allVariants} qcOrders={qcOrders} setIsLoading={setIsLoading} showToast={showToast} />;
            case 'handover_kurir': return <HandoverKurir qcOrders={qcOrders} setIsLoading={setIsLoading} showToast={showToast} />;
            case 'kas_operasional': return <KasOperasional showToast={showToast} />;
            case 'laporan_stok': return <LaporanStok variants={allVariants} transactions={transactions} products={products} currentUser={currentUser} setIsLoading={setIsLoading} showToast={showToast} />;
            case 'pantau_stok': return <PantauStok variants={allVariants} transactions={transactions} showToast={showToast} />;
            case 'stok_opname': return <StokOpname key="opname" variants={allVariants} transactions={transactions} setIsLoading={setIsLoading} showToast={showToast} currentUser={currentUser} />;
            case 'mpo_pabrik': return <ManajemenMPO variants={allVariants} mpoOrders={mpoOrders} showToast={showToast} setIsLoading={setIsLoading} />;
            case 'pengaturan': return <Pengaturan currentUser={currentUser} setIsLoading={setIsLoading} setProducts={setProducts} setTransactions={setTransactions} setCurrentUser={setCurrentUser} showToast={showToast} />;
            case 'cek_surat_jalan': return <CekSuratJalan currentUser={currentUser} variants={allVariants} mpoOrders={mpoOrders} qcOrders={qcOrders} transactions={transactions} showToast={showToast} setIsLoading={setIsLoading} />;
            default: return <Dashboard transactions={transactions} qcOrders={qcOrders} mpoOrders={mpoOrders} variants={allVariants} />;
        }
    };

    return (
        <div className="flex h-screen bg-slate-50 font-sans">
            {toast && (
                <div className={`fixed top-4 right-4 z-[99999] px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-4 text-white animate-toast border-b-4 ${toast.type === 'error' ? 'bg-red-700 border-red-900' : 'bg-teal-700 border-teal-900'}`} style={{ minWidth: 'min(300px, calc(100vw - 2rem))', maxWidth: '440px' }}>
                    <i className={`fa-solid ${toast.type === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'} text-3xl flex-shrink-0`}></i>
                    <div>
                        <h4 className="font-black text-lg leading-tight">{toast.type === 'error' ? '⚠️ Peringatan' : '✅ Berhasil'}</h4>
                        <p className="text-sm font-semibold mt-0.5 leading-snug">{toast.message}</p>
                    </div>
                </div>
            )}

            <aside className="hidden md:flex flex-col w-64 bg-[#2b3f31] text-slate-200 shadow-xl z-20 flex-shrink-0">
                <div className="flex flex-col items-center justify-center h-16 bg-[#16241a] text-white font-bold text-sm py-2 border-b border-r border-[#527A5D] flex-shrink-0">
                    <div className="flex items-center"><img src="/duolaigudang/LogoV2.png" alt="Logo" className="w-6 h-6 mr-2 object-contain animate-logo-flip" /> FARADELA MANAGEMENT</div>
                    <div className="text-[10px] text-slate-300 font-normal mt-0 tracking-wider">(Versi 2.0 by Ahmad)</div>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden py-3 space-y-0.5 px-4 custom-scrollbar">
                    {allowedMenus.map(m => (
                        <button key={m.id} onClick={() => handleMenuClick(m.id)} className={`w-full flex items-center px-3 py-2.5 text-sm font-semibold rounded-xl menu-magnify ${activeMenu === m.id ? 'bg-orange-500 text-white shadow-md active-menu' : 'text-slate-300 hover:text-white font-bold'}`}>
                            <i className={`fa-solid ${m.icon} w-5 text-center`}></i> <span className="ml-2 truncate text-left">{m.label}</span>
                        </button>
                    ))}
                </div>
                <div className="p-4 bg-[#16241a] border-t border-[#527A5D]">
                    <div className="text-xs text-center text-slate-400 mb-2 font-mono">Akun login: <span className="text-orange-500">{currentUser.username}</span></div>
                    <button onClick={() => { firebase.auth().signOut(); localStorage.removeItem('faradela_lastActivity'); setCurrentUser(null); }} className="flex items-center justify-center w-full px-3 py-3 text-sm font-bold text-orange-400 hover:bg-[#2b3f31] hover:text-orange-300 rounded-lg transition-colors border border-[#527A5D]">
                        <i className="fa-solid fa-right-from-bracket mr-2"></i> KELUAR
                    </button>
                </div>
            </aside>

            {/* SIDEBAR MOBILE */}
            {isMobileMenuOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 md:hidden" onClick={() => setIsMobileMenuOpen(false)}>
                    <div className="w-64 h-full bg-[#2b3f31] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between h-14 px-4 bg-[#16241a] text-white border-b border-[#527A5D] flex-shrink-0">
                            <div className="flex flex-col justify-center">
                                <span className="font-bold flex items-center text-sm"><img src="/duolaigudang/LogoV2.png" alt="Logo" className="w-5 h-5 mr-2 object-contain animate-logo-flip" /> FARADELA MANAGEMENT</span>
                                <span className="text-[9px] text-slate-300 font-normal mt-0">(Versi 2.0 by Ahmad)</span>
                            </div>
                            <button onClick={() => setIsMobileMenuOpen(false)} className="text-slate-400 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
                        </div>
                        <div className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-4 space-y-0.5">
                            {allowedMenus.map(m => (
                                <button key={m.id} onClick={() => handleMenuClick(m.id)} className={`w-full flex items-center px-3 py-3 text-sm font-semibold rounded-xl menu-magnify ${activeMenu === m.id ? 'bg-orange-500 text-white shadow-md active-menu' : 'text-slate-300 hover:text-white font-bold'}`}>
                                    <i className={`fa-solid ${m.icon} w-5 text-center`}></i> <span className="ml-2 text-left">{m.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {isLoading && <div className="absolute inset-0 bg-white/70 z-50 flex flex-col items-center justify-center font-black text-xl text-orange-500 backdrop-blur-sm"><i className="fa-solid fa-circle-notch fa-spin mb-3 text-3xl"></i> Loading...</div>}

                <header className="flex items-center justify-between h-14 md:h-16 px-4 md:px-6 bg-[#16241a] border-b border-[#527A5D] shadow-sm z-10 no-print">
                    <div className="flex items-center min-w-0">
                        <button className="md:hidden mr-3 text-slate-300 hover:text-white p-1.5 bg-[#2b3f31] rounded-lg flex-shrink-0" onClick={() => setIsMobileMenuOpen(true)}><i className="fa-solid fa-bars text-lg"></i></button>
                        <h1 className="text-base md:text-lg font-black text-white uppercase tracking-wide flex items-center gap-2 truncate">
                            <i className={`fa-solid ${allowedMenus.find(m => m.id === activeMenu)?.icon} text-orange-500 flex-shrink-0`}></i>
                            <span className="truncate">{allowedMenus.find(m => m.id === activeMenu)?.label}</span>
                        </h1>
                    </div>
                    <div className="flex items-center flex-shrink-0 ml-2">
                        <span className={`px-3 py-1.5 rounded-full font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm border ${currentUser.role === 'admin' ? 'bg-orange-50 text-sky-800 border-orange-200' : 'bg-teal-50 text-teal-800 border-teal-200'}`}>
                            <i className={`fa-solid ${currentUser.role === 'admin' ? 'fa-user-shield' : 'fa-user-tag'}`}></i>
                            <span className="hidden sm:inline">{currentUser.role}</span>
                        </span>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-3 md:p-6 bg-slate-50 custom-scrollbar">
                    <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {renderContent()}
                    </div>
                </div>
            </main>
        </div>
    );
}

// --- SUB-KOMPONEN ---

// ==========================================
// FITUR CETAK RESI MANUAL
// ==========================================
const handleCetakResiManual = (order, variants) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return alert("Gagal membuka tab baru. Izinkan Pop-up Blocker!");

    const dateStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    let itemsHtml = '';
    order.list_produk.forEach(item => {
        const variantInfo = variants.find(v => v.sku === item.sku);
        const displayArt = variantInfo ? variantInfo.article : item.sku;
        const displayColor = variantInfo ? variantInfo.colorName : '-';
        const displaySize = variantInfo ? variantInfo.sizeName : '-';

        itemsHtml += `
                    <tr>
                        <td class="artikel">
                            <div style="font-weight: 900; font-size: 11px;">
                                ${displayArt} | <span style="font-weight: normal; font-size: 9px;">${displayColor} (Sz: ${displaySize})</span>
                            </div>
                        </td>
                        <td style="font-weight: 900; font-size: 14px;">${item.qty}</td>
                    </tr>
                `;
    });

    const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Resi_Manual_${order.id_pesanan}</title>
                <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"><\/script>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f0f0f0; display: flex; justify-content: center; }
                    
                    .thermal-label { 
                        width: 100mm; 
                        height: 150mm; 
                        background: white; 
                        padding: 4mm; 
                        display: flex;
                        flex-direction: column;
                        overflow: hidden;
                    }

                    .top-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid black; padding-bottom: 3px; margin-bottom: 4px; }
                    .logo-brand { font-size: 16px; font-weight: 900; }
                    .print-date { font-size: 8px; font-weight: bold; }

                    .badge-row { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 4px; }
                    .badge-item { border: 1.5px solid black; padding: 2px 6px; font-size: 10px; display: flex; justify-content: space-between; align-items: center; }
                    .badge-val { font-weight: 900; font-size: 12px; }
                    .layanan-active { background: black; color: white; border-color: black; }

                    .qr-row { display: flex; align-items: center; border: 1.5px solid black; padding: 4px; margin-bottom: 4px; gap: 8px; height: 60px; }
                    #qrcode { width: 55px !important; height: 55px !important; }
                    .order-info { flex: 1; display: flex; flex-direction: column; justify-content: center; }
                    .order-id-val { font-size: 12px; font-weight: 900; font-family: monospace; }
                    .source-badge { font-size: 8px; font-weight: 900; background: #eee; padding: 1px 4px; border-radius: 2px; width: fit-content; margin-top: 1px; }

                    /* AREA UTAMA: PENERIMA & PENGIRIM */
                    .address-container { border: 2px solid black; margin-bottom: 4px; display: flex; flex-direction: column; flex-shrink: 1; min-height: 0; }
                    .section-header { background: #eee; color: black; font-size: 10px; font-weight: 900; padding: 2px 8px; text-transform: uppercase; border-bottom: 1px solid black; }
                    .content-penerima { padding: 6px 8px; border-bottom: 1.5px solid black; flex: 1; min-height: 0; overflow: hidden; }
                    .content-pengirim { padding: 4px 8px; background: #f9f9f9; }

                    .name-txt { font-size: 16px; font-weight: 900; line-height: 1.1; margin-bottom: 1px; }
                    .phone-txt { font-size: 13px; font-weight: 900; margin-bottom: 3px; display: block; }
                    .addr-txt { font-size: 12.5px; line-height: 1.2; font-weight: bold; overflow-wrap: break-word; }

                    .sender-info { font-size: 11px; font-weight: 900; line-height: 1.1; }

                    .product-section { margin-top: auto; border-top: 1.5px dashed black; padding-top: 4px; }
                    .product-table { width: 100%; border-collapse: collapse; }
                    .product-table th, .product-table td { border: 1px solid black; padding: 2px; font-size: 9px; text-align: center; }
                    .product-table th { background: #eee; font-weight: 900; }
                    .product-table td.artikel-col { text-align: left; font-weight: 900; font-size: 10px; line-height: 1.05; }

                    @page { size: 100mm 150mm; margin: 0; }
                    @media print { 
                        body { background-color: white; } 
                        .thermal-label { border: none; } 
                    }
                </style>
            </head>
            <body>
                <div class="thermal-label">
                    <div class="top-header">
                        <div class="logo-brand">FARADELA OFFICIAL</div>
                        <div class="print-date">${dateStr} | ${timeStr}</div>
                    </div>

                    <div class="badge-row">
                        <div class="badge-item ${order.layanan === 'INSTAN' ? 'layanan-active' : ''}">
                            <span>LAYANAN:</span>
                            <span class="badge-val">${order.layanan}</span>
                        </div>
                        <div class="badge-item">
                            <span>EKSPEDISI:</span>
                            <span class="badge-val">${order.ekspedisi}</span>
                        </div>
                    </div>

                    <div class="qr-row">
                        <canvas id="qrcode"></canvas>
                        <div class="order-info">
                            <div style="font-size: 8px; font-weight: 900;">NO. PESANAN:</div>
                            <div class="order-id-val">${order.id_pesanan}</div>
                            <div class="source-badge">${order.sumber.toUpperCase()}</div>
                        </div>
                    </div>

                    <div class="address-container">
                        <div class="section-header">Penerima:</div>
                        <div class="content-penerima">
                            <div class="name-txt">${order.nama_penerima}</div>
                            <div class="phone-txt">${order.nomor_telepon || '-'}</div>
                            <div class="addr-txt">${order.alamat}</div>
                        </div>
                        
                        <div class="section-header">Pengirim:</div>
                        <div class="content-pengirim">
                            <div class="sender-info">${order.nama_pengirim || 'FARADELA OFFICIAL'}</div>
                            <div class="sender-info" style="font-size: 10px; font-weight: 500;">Handphone: ${order.telepon_pengirim || '-'}</div>
                            <div class="sender-info" style="font-size: 9px; font-weight: normal; margin-top: 2px;">${order.alamat_pengirim || ''}</div>
                        </div>
                    </div>

                    <div class="product-section">
                        <div style="font-size: 9px; font-weight: 900; margin-bottom: 2px; text-align: center;">
                            RINCIAN PAKET (${order.list_produk.reduce((acc, c) => acc + c.qty, 0)} PCS)
                        </div>
                        <table class="product-table">
                            <thead>
                                <tr>
                                    <th style="text-align: left">Nama Produk / Sku</th>
                                    <th width="30">Qty</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${itemsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>

                <script>
                    window.onload = function() {
                        const canvas = document.getElementById('qrcode');
                        QRCode.toCanvas(canvas, "${order.id_pesanan}", {
                            width: 120, // Ukuran QR diperbesar sesuai request
                            margin: 1,
                            color: { dark: '#000000', light: '#ffffff' }
                        }, function (error) {
                            if (error) console.error(error);
                            setTimeout(() => { window.print(); }, 800);
                        });
                    };
                <\/script>
            </body>
            </html>
            `;
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
};

// ==========================================
// KOMPONEN PESANAN MANUAL
// ==========================================
function PesananManual({ variants, manualOrders, senderTemplates, transactions, showToast, setIsLoading, currentUser }) {
    const [activeTab, setActiveTab] = useState('DRAFT');
    const [showModal, setShowModal] = useState(false);

    // Form State
    const [sumber, setSumber] = useState('WhatsApp');
    const [layanan, setLayanan] = useState('Reguler');
    const [ekspedisi, setEkspedisi] = useState('J&T');
    const [namaPenerima, setNamaPenerima] = useState('');
    const [nomorTelepon, setNomorTelepon] = useState('');
    const [alamat, setAlamat] = useState('');

    // NEW: Sender State
    const [namaPengirim, setNamaPengirim] = useState('');
    const [teleponPengirim, setTeleponPengirim] = useState('');
    const [alamatPengirim, setAlamatPengirim] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('');

    const [listProduk, setListProduk] = useState([]); // [{ sku, qty }]

    // Search State
    const [searchSku, setSearchSku] = useState('');

    // Data Lists
    const draftList = manualOrders.filter(o => o.status === 'draft').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const riwayatList = manualOrders.filter(o => o.status !== 'draft').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const calculateAvailable = (sku) => {
        let inQty = 0; let outQty = 0;
        transactions.forEach(t => {
            if (t.sku === sku) {
                if (t.type === 'IN' || t.type === 'REVISI_IN') inQty += t.qty;
                if (t.type === 'OUT' || t.type === 'REVISI_OUT') outQty += t.qty;
            }
        });
        return inQty - outQty;
    };

    const searchResults = useMemo(() => {
        if (!searchSku || searchSku.length < 2) return [];
        const keyword = searchSku.toLowerCase().replace(/[\s\-_]+/g, '');
        return variants.filter(v => v.isActive && (
            v.sku.toLowerCase().replace(/[\s\-_]+/g, '').includes(keyword) ||
            (v.article + v.colorName + v.sizeName).toLowerCase().replace(/[\s\-_]+/g, '').includes(keyword)
        )).slice(0, 10);
    }, [searchSku, variants]);

    const addItem = (v) => {
        const stock = calculateAvailable(v.sku);
        const existing = listProduk.find(i => i.sku === v.sku);
        if (existing) {
            setListProduk(listProduk.map(i => i.sku === v.sku ? { ...i, qty: i.qty + 1 } : i));
        } else {
            setListProduk([...listProduk, { sku: v.sku, qty: 1, stockInfo: stock }]);
        }
        setSearchSku('');
    };

    const updateItemQty = (sku, newQty) => {
        if (newQty <= 0) {
            setListProduk(listProduk.filter(i => i.sku !== sku));
        } else {
            setListProduk(listProduk.map(i => i.sku === sku ? { ...i, qty: newQty } : i));
        }
    };

    const handleSelectTemplate = (id) => {
        setSelectedTemplateId(id);
        if (id === '') {
            setNamaPengirim(''); setTeleponPengirim(''); setAlamatPengirim('');
        } else {
            const t = senderTemplates.find(x => x.id === id);
            if (t) {
                setNamaPengirim(t.name);
                setTeleponPengirim(t.phone);
                setAlamatPengirim(t.address || '');
            }
        }
    };

    const handleSaveCurrentAsTemplate = async () => {
        if (!namaPengirim || !teleponPengirim) return showToast('error', 'Nama & Nomor Pengirim wajib diisi!');
        try {
            await db.collection('manual_order_senders').add({
                name: namaPengirim,
                phone: teleponPengirim,
                address: alamatPengirim,
                createdAt: new Date().toISOString()
            });
            showToast('success', 'Template Pengirim disimpan!');
        } catch (e) { showToast('error', 'Gagal simpan template'); }
    };

    const handleDeleteTemplate = async (e, id) => {
        e.stopPropagation();
        if (!window.confirm('Hapus template ini?')) return;
        try {
            await db.collection('manual_order_senders').doc(id).delete();
            if (selectedTemplateId === id) {
                setSelectedTemplateId('');
            }
            showToast('success', 'Template dihapus');
        } catch (e) { showToast('error', 'Gagal hapus template'); }
    };

    const generateOrderId = () => {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const random = Math.floor(1000 + Math.random() * 9000);
        return `FRD-MNL-${yy}${mm}${dd}-${random}`;
    };

    const handleSimpanDraft = async (e) => {
        e.preventDefault();
        if (listProduk.length === 0) return showToast('error', 'Pilih minimal 1 produk!');
        if (!namaPenerima.trim() || !alamat.trim()) return showToast('error', 'Nama & Alamat Penerima wajib diisi!');

        setIsLoading(true);
        try {
            const orderId = generateOrderId();
            await db.collection('manual_orders').add({
                id_pesanan: orderId,
                sumber,
                layanan,
                ekspedisi,
                nama_penerima: namaPenerima,
                nomor_telepon: nomorTelepon,
                alamat,
                nama_pengirim: namaPengirim,
                telepon_pengirim: teleponPengirim,
                alamat_pengirim: alamatPengirim,
                list_produk: listProduk.map(p => ({ sku: p.sku, qty: p.qty })),
                status: 'draft',
                createdAt: new Date().toISOString(),
                createdBy: currentUser.username
            });
            showToast('success', 'Berhasil menyimpan draft pesanan manual!');
            setShowModal(false);
            // Reset Form
            setNamaPenerima(''); setNomorTelepon(''); setAlamat(''); setListProduk([]);
        } catch (err) {
            console.error(err);
            showToast('error', 'Gagal menyimpan data.');
        }
        setIsLoading(false);
    };

    const handleBypassInstan = async (order) => {
        if (!window.confirm(`Yakin memproses instan pesanan ${order.id_pesanan}? Ini akan Bypas GRPA, memotong stok Gudang Utama, dan langsung mencetak resi.`)) return;

        setIsLoading(true);
        try {
            const batch = db.batch();
            const nowStr = new Date().toISOString();

            // 1. Catat Tranaksi OUT (Pemotongan)
            order.list_produk.forEach(item => {
                const txRef = db.collection('transactions').doc();
                batch.set(txRef, {
                    sku: item.sku,
                    qty: item.qty,
                    type: 'OUT',
                    date: nowStr,
                    note: `Pesanan Manual INSTAN - ${order.id_pesanan} (${order.ekspedisi})`,
                    user: currentUser.username,
                    fullBarcode: `${item.sku}Instan${Date.now()}` // Fake barcode to trace
                });
            });

            // 2. Ubah Status Pesanan Manual ke instan_diproses
            const orderRef = db.collection('manual_orders').doc(order.id);
            batch.update(orderRef, {
                status: 'instan_diproses',
                processedAt: nowStr
            });

            await batch.commit();
            showToast('success', 'Berhasil diproses instan! Stok telah dipotong.');
            handleCetakResiManual(order, variants);
        } catch (err) {
            console.error(err);
            showToast('error', 'Gagal memproses instan pesanan.');
        }
        setIsLoading(false);
    };

    const handleDeleteDraft = async (id) => {
        if (!window.confirm('Yakin ingin menghapus draf ini?')) return;
        try {
            await db.collection('manual_orders').doc(id).delete();
            showToast('success', 'Draft dihapus');
        } catch (err) { showToast('error', 'Gagal hapus'); }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-black text-slate-800"><i className="fa-solid fa-envelope-open-text text-orange-500 mr-2"></i> Pesanan Manual</h2>
                    <p className="text-sm font-semibold text-slate-500">Kelola pesanan dari WA, Endorse, dan lainnya yang tidak memiliki resi marketplace otomatis.</p>
                </div>
                <button onClick={() => setShowModal(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-md shadow-orange-500/30 flex items-center justify-center">
                    <i className="fa-solid fa-plus mr-2"></i> Buat Pesanan
                </button>
            </div>

            <div className="flex bg-slate-200/50 p-1.5 rounded-xl w-fit">
                <button onClick={() => setActiveTab('DRAFT')} className={`px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'DRAFT' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Draft ({draftList.length})</button>
                <button onClick={() => setActiveTab('RIWAYAT')} className={`px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === 'RIWAYAT' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Riwayat Proses ({riwayatList.length})</button>
            </div>

            {activeTab === 'DRAFT' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 font-bold text-slate-700 flex items-center justify-between bg-slate-50/50">
                        <span>Menunggu Diproses di GRPA</span>
                        <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1 rounded-full"><i className="fa-solid fa-info-circle mr-1"></i> Centang opsi 'Sertakan Pesanan Manual' di menu GRPA untuk memproses data ini.</span>
                    </div>
                    {draftList.length === 0 ? (
                        <div className="p-10 text-center text-slate-400 font-semibold"><i className="fa-solid fa-inbox text-5xl mb-3 opacity-30 block"></i> Tidak ada draft pesanan manual.</div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {draftList.map(order => (
                                <div key={order.id} className="p-5 hover:bg-slate-50 transition-colors">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                                        <div>
                                            <div className="font-black text-lg text-slate-800 flex items-center gap-2">
                                                {order.id_pesanan}
                                                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold uppercase border border-slate-200">{order.sumber}</span>
                                            </div>
                                            <div className="text-sm font-semibold text-slate-600 mt-1">Yth. <span className="text-blue-700 font-bold">{order.nama_penerima}</span> ({order.nomor_telepon || '-'})</div>
                                            <div className="text-xs text-slate-500 mt-0.5 italic">{order.ekspedisi} - {order.layanan}</div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button onClick={() => handleDeleteDraft(order.id)} className="px-4 py-2 border-2 border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-500 hover:border-red-200 rounded-lg font-bold text-xs transition-colors"><i className="fa-solid fa-trash-can mr-1"></i> Hapus</button>
                                            <button onClick={() => handleBypassInstan(order)} className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold text-xs transition-colors border-b-4 border-slate-950 flex items-center gap-2"><i className="fa-solid fa-rocket text-orange-400"></i> Proses Instan (Bypass & Cetak)</button>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 border-b border-slate-200 pb-1">Daftar Produk (${order.list_produk.reduce((a, c) => a + c.qty, 0)} Pcs)</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {order.list_produk.map((item, idx) => {
                                                const varInfo = variants.find(v => v.sku === item.sku);
                                                return (
                                                    <div key={idx} className="flex justify-between items-center text-sm bg-white p-2 rounded border border-slate-100 shadow-sm">
                                                        <div className="font-semibold text-slate-700 overflow-hidden text-ellipsis whitespace-nowrap" title={varInfo ? varInfo.article : item.sku}>
                                                            <span className="text-orange-600 mr-2">■</span><b>{varInfo ? varInfo.article : item.sku}</b> <span className="text-xs text-slate-400 font-normal">({varInfo ? varInfo.colorName : ''} - {varInfo ? varInfo.sizeName : ''})</span>
                                                        </div>
                                                        <div className="font-black text-slate-800 px-2 py-0.5 bg-slate-100 rounded">{item.qty}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'RIWAYAT' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    {riwayatList.length === 0 ? (
                        <div className="p-10 text-center text-slate-400 font-semibold"><i className="fa-regular fa-folder-open text-5xl mb-3 opacity-30 block"></i> Tidak ada riwayat pesanan.</div>
                    ) : (
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-50 text-slate-500 font-bold sticky top-0 border-b border-slate-200">
                                <tr>
                                    <th className="p-4 py-3">ID Pesanan</th>
                                    <th className="p-4 py-3">Penerima</th>
                                    <th className="p-4 py-3">Telepon</th>
                                    <th className="p-4 py-3">Kurir</th>
                                    <th className="p-4 py-3">Status</th>
                                    <th className="p-4 py-3 text-right">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                                {riwayatList.map(order => (
                                    <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4">
                                            <div className="font-black text-slate-800">{order.id_pesanan}</div>
                                            <div className="text-[10px] text-slate-400 uppercase mt-0.5">{order.sumber} &bull; {new Date(order.createdAt).toLocaleDateString('id-ID')}</div>
                                        </td>
                                        <td className="p-4">{order.nama_penerima}</td>
                                        <td className="p-4 font-mono text-xs">{order.nomor_telepon || '-'}</td>
                                        <td className="p-4"><span className="bg-slate-100 text-slate-700 px-2 py-1 rounded font-bold text-xs border border-slate-200">{order.ekspedisi}</span></td>
                                        <td className="p-4">
                                            {order.status === 'direkap' && <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded"><i className="fa-solid fa-server mr-1"></i> Diproses GRPA</span>}
                                            {order.status === 'instan_diproses' && <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded"><i className="fa-solid fa-bolt mr-1"></i> Instan (Selesai)</span>}
                                        </td>
                                        <td className="p-4 text-right">
                                            <button onClick={() => handleCetakResiManual(order, variants)} className="px-3 py-1.5 bg-orange-50 text-orange-600 hover:bg-orange-100 rounded-lg font-bold text-xs border border-orange-200 transition-colors"><i className="fa-solid fa-print mr-1"></i> Cetak Resi</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Modal Buat Pesanan */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] overflow-hidden">
                        <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <h3 className="font-black text-lg text-slate-800"><i className="fa-solid fa-pen-to-square text-orange-500 mr-2"></i> Buat Pesanan Manual</h3>
                            <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-rose-500"><i className="fa-solid fa-xmark text-2xl"></i></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 font-semibold custom-scrollbar">
                            <form id="formPesananManual" onSubmit={handleSimpanDraft}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                    {/* Kolom Kiri: Info Konsumen */}
                                    <div className="space-y-4">
                                        <h4 className="font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">Informasi Pelanggan</h4>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Sumber Masuk</label>
                                            <select value={sumber} onChange={e => setSumber(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-3 focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 font-bold text-slate-700 bg-white">
                                                <option value="WhatsApp">WhatsApp</option>
                                                <option value="Endorse/Affiliate">Endorse/Affiliate</option>
                                                <option value="Resize">Tukar (Resize)</option>
                                                <option value="Lainnya">Lainnya...</option>
                                            </select>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Layanan</label>
                                                <select value={layanan} onChange={e => setLayanan(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-3 focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 font-bold text-slate-700 bg-white">
                                                    <option value="Reguler">Reguler</option>
                                                    <option value="DFOD">DFOD</option>
                                                    <option value="Instan">Instan</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Ekspedisi</label>
                                                <select value={ekspedisi} onChange={e => setEkspedisi(e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-3 focus:outline-none focus:border-orange-500 font-bold text-slate-700 bg-white">
                                                    <option value="J&T">J&T</option>
                                                    <option value="JNE">JNE</option>
                                                    <option value="SICEPAT">SiCepat</option>
                                                    <option value="GOSEND">GoSend</option>
                                                    <option value="WAHANA">Wahana</option>
                                                    <option value="OWN_COURIER">Kurir Pribadi</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Nama Penerima</label>
                                            <input required value={namaPenerima} onChange={e => setNamaPenerima(e.target.value)} type="text" placeholder="Contoh: Budi Santoso" className="w-full border-2 border-slate-200 rounded-xl p-3 focus:outline-none focus:border-orange-500 bg-slate-50 focus:bg-white" />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Nomor Telepon</label>
                                            <input required value={nomorTelepon} onChange={e => setNomorTelepon(e.target.value)} type="tel" placeholder="0812xxxx / 628xxxx" className="w-full border-2 border-slate-200 rounded-xl p-3 focus:outline-none focus:border-orange-500 bg-slate-50 focus:bg-white" />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Alamat Lengkap</label>
                                            <textarea required value={alamat} onChange={e => setAlamat(e.target.value)} placeholder="Jalan, RT/RW, Kel, Kec, Kota, kodepos" rows="3" className="w-full border-2 border-slate-200 rounded-xl p-3 focus:outline-none focus:border-orange-500 bg-slate-50 focus:bg-white resize-none"></textarea>
                                        </div>

                                        <h4 className="font-bold text-slate-800 border-b border-slate-200 pb-2 pt-4 mb-3">Informasi Pengirim</h4>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1.5 uppercase font-bold tracking-wider">Template Pengirim</label>
                                            <div className="flex gap-2">
                                                <select value={selectedTemplateId} onChange={e => handleSelectTemplate(e.target.value)} className="flex-1 border-2 border-slate-200 rounded-xl p-3 focus:outline-none focus:border-orange-500 font-bold text-slate-700 bg-white">
                                                    <option value="">-- Input Manual --</option>
                                                    {senderTemplates.map(t => (
                                                        <option key={t.id} value={t.id}>{t.name} ({t.phone})</option>
                                                    ))}
                                                </select>
                                                {selectedTemplateId && (
                                                    <button type="button" onClick={(e) => handleDeleteTemplate(e, selectedTemplateId)} className="bg-red-50 text-red-500 border-2 border-red-100 p-3 rounded-xl hover:bg-red-500 hover:text-white transition-all">
                                                        <i className="fa-solid fa-trash-can"></i>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                                            <div>
                                                <label className="block text-[10px] text-slate-500 mb-1 uppercase font-bold tracking-wider">Nama Pengirim</label>
                                                <input required value={namaPengirim} onChange={e => setNamaPengirim(e.target.value)} type="text" placeholder="Nama Toko / Pengirim" className="w-full border-2 border-slate-200 rounded-lg p-2 focus:outline-none focus:border-blue-500 text-sm" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-500 mb-1 uppercase font-bold tracking-wider">No. HP Pengirim</label>
                                                <input required value={teleponPengirim} onChange={e => setTeleponPengirim(e.target.value)} type="tel" placeholder="08xxxx" className="w-full border-2 border-slate-200 rounded-lg p-2 focus:outline-none focus:border-blue-500 text-sm" />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-500 mb-1 uppercase font-bold tracking-wider">Alamat Pengirim</label>
                                                <textarea value={alamatPengirim} onChange={e => setAlamatPengirim(e.target.value)} placeholder="Kota / Alamat Lengkap" rows="2" className="w-full border-2 border-slate-200 rounded-lg p-2 focus:outline-none focus:border-blue-500 text-sm resize-none" />
                                            </div>
                                            <button type="button" onClick={handleSaveCurrentAsTemplate} className="w-full py-2 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-blue-700 shadow-md shadow-blue-500/20">
                                                <i className="fa-solid fa-cloud-arrow-up mr-1"></i> Simpan Sebagai Template Baru
                                            </button>
                                        </div>
                                    </div>

                                    {/* Kolom Kanan: Produk */}
                                    <div className="space-y-4">
                                        <h4 className="font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">Daftar Produk</h4>

                                        {/* Pencarian Produk */}
                                        <div className="relative">
                                            <div className="flex items-center border-2 border-slate-200 rounded-xl bg-white focus-within:border-orange-500 focus-within:ring-4 focus-within:ring-orange-500/10 transition-all overflow-hidden">
                                                <i className="fa-solid fa-search text-slate-400 pl-4"></i>
                                                <input type="text" value={searchSku} onChange={e => setSearchSku(e.target.value)} placeholder="Ketik SKU atau Artikel untuk mencari..." className="w-full p-3 pl-3 outline-none font-semibold text-sm bg-transparent" />
                                            </div>
                                            {searchResults.length > 0 && (
                                                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-60 overflow-y-auto z-[60] divide-y divide-slate-100">
                                                    {searchResults.map((v, idx) => (
                                                        <button key={idx} type="button" onClick={() => addItem(v)} className="w-full text-left p-3 hover:bg-orange-50 transition-colors flex items-center justify-between group">
                                                            <div>
                                                                <div className="font-bold text-slate-800 text-sm group-hover:text-orange-700">{v.article} <span className="text-xs text-slate-500 font-normal">({v.colorName} - {v.sizeName})</span></div>
                                                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">{v.sku}</div>
                                                            </div>
                                                            <div className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-bold">Tambah</div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* List Produk Terpilih */}
                                        <div className="bg-slate-50 rounded-xl border border-slate-200 min-h-[150px] p-3 space-y-2">
                                            {listProduk.length === 0 ? (
                                                <div className="text-center text-slate-400 text-sm py-10 font-semibold italic">Belum ada produk yang dipilih.</div>
                                            ) : (
                                                listProduk.map(item => {
                                                    const varInfo = variants.find(v => v.sku === item.sku);
                                                    return (
                                                        <div key={item.sku} className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between shadow-sm">
                                                            <div className="min-w-0 flex-1 pr-3">
                                                                <div className="font-bold text-slate-800 text-sm truncate">{varInfo ? varInfo.article : item.sku}</div>
                                                                <div className="text-[11px] text-slate-500 truncate">{varInfo ? `${varInfo.colorName} - ${varInfo.sizeName} | Stok Gudang: ${item.stockInfo}` : item.sku}</div>
                                                            </div>
                                                            <div className="flex items-center gap-2 flex-shrink-0 bg-slate-100 p-1 rounded-lg border border-slate-200">
                                                                <button type="button" onClick={() => updateItemQty(item.sku, item.qty - 1)} className="w-7 h-7 bg-white rounded text-slate-500 hover:text-red-500 hover:bg-red-50 font-black flex items-center justify-center shadow-sm"><i className="fa-solid fa-minus text-[10px]"></i></button>
                                                                <span className="w-6 text-center font-black text-slate-800 text-sm">{item.qty}</span>
                                                                <button type="button" onClick={() => updateItemQty(item.sku, item.qty + 1)} className="w-7 h-7 bg-white rounded text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 font-black flex items-center justify-center shadow-sm"><i className="fa-solid fa-plus text-[10px]"></i></button>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>

                                    </div>
                                </div>
                            </form>
                        </div>
                        <div className="p-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                            <div className="text-sm font-semibold text-slate-500">Total: <span className="font-black text-lg text-slate-800">{listProduk.reduce((a, c) => a + c.qty, 0)} Pcs</span></div>
                            <div className="flex gap-3">
                                <button type="button" onClick={() => setShowModal(false)} className="px-6 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors">Batal</button>
                                <button form="formPesananManual" type="submit" className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 rounded-xl font-bold shadow-md shadow-orange-500/30 transition-all focus:ring-4 focus:ring-orange-500/20">Simpan Draf</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ==========================================
// SUPER-GRPA (Mengirim Data ke Antrean QC)
// ==========================================
function GeneratorRekapanAHD({ variants, transactions, manualOrders, setIsLoading, showToast, currentUser }) {
    const [shopeeFiles, setShopeeFiles] = useState([]);
    const [tiktokFiles, setTiktokFiles] = useState([]);
    const [lazadaFiles, setLazadaFiles] = useState([]);

    const shopeeRef = useRef(null);
    const tiktokRef = useRef(null);
    const lazadaRef = useRef(null);

    const [analysisResult, setAnalysisResult] = useState(null);
    const [activeTab, setActiveTab] = useState('PO');
    const [activePreviewTab, setActivePreviewTab] = useState('PREV-ALL'); // State terpisah untuk preview tab
    const [platformStats, setPlatformStats] = useState(null);
    const [analysisTime, setAnalysisTime] = useState(null);
    const [pdfTrackingData, setPdfTrackingData] = useState([]); // Untuk menyimpan referensi halaman PDF dari analisis terakhir
    const [draftPdfTrackingData, setDraftPdfTrackingData] = useState([]); // Akumulasi PDF tracking dari semua batch di antrean
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    // State untuk fitur antrian PO
    const todayStr = new Date().toISOString().split('T')[0];
    const [poDrafts, setPoDrafts] = useState([]);
    const [readyDrafts, setReadyDrafts] = useState([]);
    const [poDraftDate, setPoDraftDate] = useState(todayStr);
    const [poDraftLoading, setPoDraftLoading] = useState(false);
    const [poSession, setPoSession] = useState(1);

    // State untuk Manual Orders Injection
    const [includeManual, setIncludeManual] = useState(false);
    const [includedManualOrderIds, setIncludedManualOrderIds] = useState([]);

    // State untuk riwayat pesanan online (SPO)
    const [onlineHistory, setOnlineHistory] = useState([]);

    // State untuk Preview Resi (Fitur Baru)
    const [resiPreviews, setResiPreviews] = useState({});
    const [massBatasKirim, setMassBatasKirim] = useState('');
    const [showResiPreview, setShowResiPreview] = useState(false);
    const [editedResiItems, setEditedResiItems] = useState({}); // Track data resi yang sudah diedit {resiId-idx: {article, colorName, sizeName, shipDate}}
    const [hasEdits, setHasEdits] = useState(false); // Flag untuk track ada perubahan
    const [editedItemsTracking, setEditedItemsTracking] = useState({}); // Track edited items untuk marking saat print
    const [isLoadingLocal, setIsLoadingLocal] = useState(false); // Track loading state untuk button disable

    // State untuk Affiliate (PDF)
    const [affiliateTiktokFiles, setAffiliateTiktokFiles] = useState([]);

    // Load antrian PO dari Firestore saat komponen dimuat
    const loadPODrafts = async () => {
        try {
            const snap = await window.db.collection('po_drafts').orderBy('savedAt', 'asc').get();
            setPoDrafts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) { console.error('Gagal load PO drafts:', e); }
    };

    const loadReadyDrafts = async () => {
        try {
            const snap = await window.db.collection('ready_drafts').orderBy('savedAt', 'asc').get();
            setReadyDrafts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) { console.error('Gagal load Ready drafts:', e); }
    };

    const loadOnlineHistory = async () => {
        try {
            const snap = await window.db.collection('online_history').orderBy('savedAt', 'desc').limit(20).get();
            setOnlineHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) { console.error('Gagal load Online History:', e); }
    };

    React.useEffect(() => { loadPODrafts(); loadReadyDrafts(); loadOnlineHistory(); }, []);

    // Simpan batch PO saat ini ke Firestore sebagai draft
    const handleSavePODraft = async () => {
        if (!analysisResult || analysisResult.poList.length === 0) return showToast('error', 'Tidak ada PO untuk disimpan.');
        setPoDraftLoading(true);
        const resiOnline = (platformStats?.shopee?.resi || 0) + (platformStats?.tiktok?.resi || 0) + (platformStats?.lazada?.resi || 0);
        const resiAll = resiOnline + (includeManual ? (platformStats?.manual?.resi || 0) : 0);
        const pcsOnline = (platformStats?.shopee?.pcs || 0) + (platformStats?.tiktok?.pcs || 0) + (platformStats?.lazada?.pcs || 0);
        const pcsAll = pcsOnline + (includeManual ? (platformStats?.manual?.pcs || 0) : 0);
        const pcsReady = analysisResult.readyList.reduce((a, c) => a + c.qty, 0);
        const pcsPO = analysisResult.poList.reduce((a, c) => a + c.missingQty, 0);
        try {
            await window.db.collection('po_drafts').add({
                savedAt: new Date().toISOString(),
                targetDate: poDraftDate,
                session: poSession,
                totalResiAll: resiAll,
                totalResiOnline: resiOnline,
                totalPcsAll: pcsAll,
                totalPcsOnline: pcsOnline,
                totalPcsReady: pcsReady,
                totalPcsPO: pcsPO,
                items: analysisResult.poList.map(item => ({
                    article: item.variant.article,
                    colorName: item.variant.colorName,
                    sizeName: item.variant.sizeName,
                    missingQty: item.missingQty,
                    isUrgent: item.isUrgent || false
                }))
            });
            await loadPODrafts();
            showToast('success', `Antrian PO berhasil disimpan! (${analysisResult.poList.reduce((a, c) => a + c.missingQty, 0)} pcs)`);
        } catch (e) {
            showToast('error', 'Gagal menyimpan antrian PO.');
            console.error(e);
        }
        setPoDraftLoading(false);
    };

    // Gabungkan semua draft, generate PDF, lalu hapus semua draft dari Firestore
    const handleKirimProduksi = async () => {
        if (poDrafts.length === 0) return showToast('error', 'Tidak ada antrian PO.');
        const confirmed = window.confirm(`Kirim ${poDrafts.length} batch PO ke produksi? Semua antrian akan dihapus setelah PDF dibuat.`);
        if (!confirmed) return;
        setPoDraftLoading(true);
        try {
            // SIMPAN KE RIWAYAT (online_history)
            const historyId = 'SPO-' + Date.now();
            const historyData = {
                savedAt: new Date().toISOString(),
                targetDate: poDrafts[0]?.targetDate || todayStr,
                session: poDrafts[0]?.session || 1,
                batchCount: poDrafts.length,
                totalResiAll: poDrafts.reduce((acc, d) => acc + (d.totalResiAll || 0), 0),
                totalResiOnline: poDrafts.reduce((acc, d) => acc + (d.totalResiOnline || 0), 0),
                totalPcsAll: poDrafts.reduce((acc, d) => acc + (d.totalPcsAll || 0), 0),
                totalPcsOnline: poDrafts.reduce((acc, d) => acc + (d.totalPcsOnline || 0), 0),
                totalPcsPO: poDrafts.reduce((acc, d) => acc + (d.totalPcsPO || 0), 0),
                totalPcsReady: poDrafts.reduce((acc, d) => acc + (d.totalPcsReady || 0), 0)
            };

            const collapsedPoDraftItems = [];
            poDrafts.forEach(d => {
                (d.items || []).forEach(it => {
                    const existing = collapsedPoDraftItems.find(x => x.article === it.article && x.colorName === it.colorName && x.sizeName === it.sizeName);
                    if (existing) {
                        existing.missingQty += (it.missingQty || 0);
                    } else {
                        collapsedPoDraftItems.push({ ...it });
                    }
                });
            });
            historyData.items = collapsedPoDraftItems;

            // Gabungkan SEMUA pdfTrackingInfo dari poDrafts dan readyDrafts
            let mergedPdfTrackingInfo = [];
            poDrafts.forEach(d => {
                if (d.pdfTrackingInfo) mergedPdfTrackingInfo = [...mergedPdfTrackingInfo, ...d.pdfTrackingInfo];
            });
            readyDrafts.forEach(d => {
                if (d.pdfTrackingInfo) mergedPdfTrackingInfo = [...mergedPdfTrackingInfo, ...d.pdfTrackingInfo];
            });

            // Hapus duplikat berdasarkan resi
            const uniqueResiSet = new Set();
            const finalPdfTrackingInfo = [];
            mergedPdfTrackingInfo.forEach(info => {
                if (!uniqueResiSet.has(info.resi)) {
                    uniqueResiSet.add(info.resi);
                    finalPdfTrackingInfo.push(info);
                }
            });

            historyData.pdfTrackingInfo = finalPdfTrackingInfo;

            // Extract unique URLs to save into historyData.pdfUrls
            const uniqueUrlsMap = new Map();
            finalPdfTrackingInfo.forEach(track => {
                if (track.url && track.fileName && !uniqueUrlsMap.has(track.fileName)) {
                    uniqueUrlsMap.set(track.fileName, track.url);
                }
            });
            const validUrls = Array.from(uniqueUrlsMap.entries()).map(([name, url]) => ({ name, url }));
            
            if (validUrls.length > 0) {
                historyData.pdfUrls = validUrls;
            }

            await window.db.collection('online_history').doc(historyId).set(historyData);
            if (!window.pdfTrackingCache) window.pdfTrackingCache = {};
            
            const qcSnapAll = await window.db.collection('qc_orders')
                .where('poDate', '==', poDrafts[0]?.targetDate || todayStr)
                .where('session', '==', poDrafts[0]?.session || 1)
                .get();
            const allQcOrdersForSession = qcSnapAll.docs.map(d => ({id: d.id, ...d.data()}));
            
            // Kita KOSONGKAN cache lokal, karena file sekarang ada di Cloudinary.
            // Biarkan handleRePrintResi mengunduhnya secara otomatis saat diperlukan.
            window.pdfTrackingCache[historyId] = null;
            
            await loadJsPdf();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');

            // Ambil info tanggal + sesi dari draft pertama
            const firstDraft = poDrafts[0];
            const firstDateKey = firstDraft.targetDate || firstDraft.savedAt.split('T')[0];
            const firstDateLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(firstDateKey + 'T12:00:00'));
            const sesiLabel = firstDraft.session ? ` (SESI ${firstDraft.session})` : '';

            // JUDUL UTAMA
            doc.setFontSize(22);
            doc.setTextColor(220, 38, 38);
            doc.setFont('times', 'bold');
            doc.text('PESANAN ONLINE FARADELA OFFICIAL', 105, 18, { align: 'center' });

            // TANGGAL + SESI sebagai subtitle di bawah judul
            const dateText = `${firstDateLabel}${sesiLabel}`.trim();
            doc.setFontSize(16);
            doc.setTextColor(220, 38, 38);
            doc.setFont('times', 'italic');
            doc.text(dateText, 105, 27, { align: 'center' });

            // Kotak Merah mengelilingi Tanggal (menyesuaikan ukuran lebar text)
            const textWidth = doc.getTextWidth(dateText);
            doc.setDrawColor(220, 38, 38);
            doc.setLineWidth(0.8);
            doc.rect(105 - (textWidth / 2) - 5, 20.5, textWidth + 10, 9); // x, y, w, h

            // Gabungkan item dari semua draft
            const tableData = [];
            const groupedItemsMap = {};

            poDrafts.forEach(draft => {
                draft.items.forEach(item => {
                    const key = `${item.article}-${item.colorName}-${item.sizeName}`;
                    if (!groupedItemsMap[key]) {
                        groupedItemsMap[key] = { ...item };
                    } else {
                        groupedItemsMap[key].missingQty += item.missingQty;
                        if (item.isUrgent) groupedItemsMap[key].isUrgent = true;
                    }
                });
            });

            const sortItems = (a, b) => {
                const infoA = parseArticleForSortGlobal(a.article);
                const infoB = parseArticleForSortGlobal(b.article);

                if (infoA.prefix !== infoB.prefix) return infoA.prefix.localeCompare(infoB.prefix, undefined, { numeric: true });
                if (infoA.group !== infoB.group) return infoA.group - infoB.group;
                if (infoA.num !== infoB.num) return infoA.num - infoB.num;

                const varA = variants.find(v => v.article === a.article && v.colorName === a.colorName);
                const varB = variants.find(v => v.article === b.article && v.colorName === b.colorName);
                const colA = varA ? (varA.colorIndex !== undefined ? varA.colorIndex : 999) : 999;
                const colB = varB ? (varB.colorIndex !== undefined ? varB.colorIndex : 999) : 999;
                if (colA !== colB) return colA - colB;
                return a.sizeName.localeCompare(b.sizeName, undefined, { numeric: true });
            };

            const mergedItems = Object.values(groupedItemsMap).sort(sortItems);

            // Pisahkan antara F07 dan Bukan F07
            const mainItems = mergedItems.filter(i => !i.article.toUpperCase().startsWith('F07-'));
            const f07Items = mergedItems.filter(i => i.article.toUpperCase().startsWith('F07-'));

            const drawTablePage = (items, isF07Mode) => {
                doc.setFontSize(22);
                doc.setTextColor(220, 38, 38);
                doc.setFont('times', 'bold');
                doc.text(isF07Mode ? 'PESANAN ONLINE FARADELA OFFICIAL' : 'PESANAN ONLINE FARADELA OFFICIAL', 105, 18, { align: 'center' });

                doc.setFontSize(16);
                doc.setTextColor(220, 38, 38);
                doc.setFont('times', 'italic');
                doc.text(dateText, 105, 27, { align: 'center' });

                const textWidth = doc.getTextWidth(dateText);
                doc.setDrawColor(220, 38, 38);
                doc.setLineWidth(0.8);
                doc.rect(105 - (textWidth / 2) - 5, 20.5, textWidth + 10, 9); // x, y, w, h

                const tableData = [];
                let totalAll = 0;

                items.forEach((item) => {
                    // Jika mode F07, buang awalan "F07-" dan hilangkan akhiran .1 / .2 di kertas cetak khusus F07
                    let displayArt = item.article;
                    if (isF07Mode && displayArt.toUpperCase().startsWith('F07-')) {
                        displayArt = displayArt.substring(4).replace(/^0+/, '').replace(/\.\d+$/, '');
                    }
                    tableData.push([displayArt, item.colorName, item.sizeName, item.missingQty.toString(), item.isUrgent]);
                    totalAll += item.missingQty;
                });

                tableData.push(['TOTAL', '', '', totalAll.toString(), false]);

                doc.autoTable({
                    startY: 40,
                    head: [['ARTICLE', 'COLOUR', 'SIZE', 'JUMLAH']],
                    body: tableData.map(r => r.slice(0, 4)),
                    theme: 'grid',
                    styles: { font: 'times', fontSize: 13, halign: 'center', valign: 'middle', lineColor: 0, lineWidth: 0.5 },
                    headStyles: { fillColor: [226, 239, 218], fontStyle: 'bold', textColor: 0 },
                    didParseCell: (data) => {
                        if (data.section === 'body') {
                            const row = tableData[data.row.index];
                            if (data.row.index === tableData.length - 1) { // Baris TOTAL
                                data.cell.styles.fontStyle = 'bold';
                                data.cell.styles.fontSize = 16;
                                if (data.column.index === 3) data.cell.styles.textColor = [220, 38, 38];
                                if (data.column.index === 0) {
                                    data.cell.colSpan = 3;
                                    data.cell.styles.halign = 'center';
                                }
                            } else if (row && row[4]) {
                                data.cell.styles.textColor = [220, 38, 38];
                                data.cell.styles.fontStyle = 'bold';
                            }
                        }
                    }
                });
            };

            if (mainItems.length > 0) {
                drawTablePage(mainItems, false);
            }

            if (f07Items.length > 0) {
                if (mainItems.length > 0) doc.addPage();
                drawTablePage(f07Items, true);
            }

            // LOGIKA BARU: Buka PDF di Tab Baru (Tidak auto-download)
            const pdfBlobUrl = doc.output('bloburl');
            window.open(pdfBlobUrl, '_blank');

            // Hapus semua draft dari Firestore
            const batchDel = window.db.batch();
            poDrafts.forEach(d => batchDel.delete(window.db.collection('po_drafts').doc(d.id)));
            readyDrafts.forEach(d => batchDel.delete(window.db.collection('ready_drafts').doc(d.id)));

            // LOGIKA PERBAIKAN: Hanya rilis sesi yang ada di SPO ini (agar Dashboard = SPO)
            try {
                const sessionsToRelease = new Set();
                poDrafts.forEach(d => {
                    const dDate = d.targetDate || (d.savedAt ? d.savedAt.split('T')[0] : new Date().toISOString().split('T')[0]);
                    sessionsToRelease.add(`${dDate}_|_${d.session || 1}`);
                });

                const qcSnap = await window.db.collection('qc_orders').get();
                qcSnap.forEach(docSnap => {
                    const o = docSnap.data();
                    const isPending = o.status === 'PENDING' || o.status === 'TRANSIT';
                    const oDate = o.poDate || (o.createdAt ? o.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]);
                    const oSession = o.session || 1;
                    const oKey = `${oDate}_|_${oSession}`;

                    if (sessionsToRelease.has(oKey) && isPending && o.isReleasedToProduction !== true) {
                        batchDel.update(docSnap.ref, { isReleasedToProduction: true, poReleasedTimestamp: Date.now() });
                    }
                });
            } catch (e) { }

            await batchDel.commit();
            await loadPODrafts();
            await loadReadyDrafts();
            setDraftPdfTrackingData([]); // Kosongkan akumulasi PDF
            showToast('success', 'PDF PO berhasil dibuat dan Antrean Resmi Meluncur ke Produksi!');
        } catch (e) {
            showToast('error', 'Gagal membuat PDF.');
            console.error(e);
        }
        setPoDraftLoading(false);
    };

    // FUNGSI RIWAYAT: RE-PRINT SPO
    const handleRePrintSPO = async (batch) => {
        setIsLoading(true);
        try {
            // Hitung ulang isUrgent secara dinamis berdasarkan tanggal hari ini
            const todayCompareStr = new Date().toISOString().split('T')[0];
            const qcSnap = await window.db.collection('qc_orders')
                .where('poDate', '==', batch.targetDate)
                .where('session', '==', batch.session)
                .get();
            
            const urgentKeys = new Set();
            qcSnap.docs.forEach(d => {
                const order = d.data();
                if (order.shipDate) {
                    let shipDateStr = typeof order.shipDate === 'string' ? order.shipDate : new Date(order.shipDate).toISOString().split('T')[0];
                    if (shipDateStr <= todayCompareStr) {
                        (order.items || []).forEach(item => {
                            if (item.status === 'PO' || item.status === 'UNRECOGNIZED') {
                                const v = variants.find(v => v.sku === (item.sku || item.sysSku));
                                if (v) {
                                    urgentKeys.add(`${v.article}-${v.colorName}-${v.sizeName}`);
                                }
                            }
                        });
                    }
                }
            });

            await loadJsPdf();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');

            const firstDateKey = batch.targetDate;
            const firstDateLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(firstDateKey + 'T12:00:00'));
            const sesiLabel = batch.session ? ` (SESI ${batch.session})` : '';
            const dateText = `${firstDateLabel}${sesiLabel}`.trim();

            const groupedItemsMap = {};
            batch.items.forEach(item => {
                const key = `${item.article}-${item.colorName}-${item.sizeName}`;
                
                // Override isUrgent jika hari ini sudah masuk deadline
                if (urgentKeys.has(key)) {
                    item.isUrgent = true;
                }

                if (!groupedItemsMap[key]) {
                    groupedItemsMap[key] = { ...item };
                } else {
                    groupedItemsMap[key].missingQty += item.missingQty;
                    if (item.isUrgent) groupedItemsMap[key].isUrgent = true;
                }
            });

            const sortItems = (a, b) => {
                const artCmp = a.article.localeCompare(b.article);
                if (artCmp !== 0) return artCmp;
                const varA = variants.find(v => v.article === a.article && v.colorName === a.colorName);
                const varB = variants.find(v => v.article === b.article && v.colorName === b.colorName);
                const colA = varA ? varA.colorIndex : 999;
                const colB = varB ? varB.colorIndex : 999;
                const colCmp = colA - colB;
                if (colCmp !== 0) return colCmp;
                return a.sizeName.localeCompare(b.sizeName, undefined, { numeric: true });
            };

            const mergedItems = Object.values(groupedItemsMap).sort(sortItems);
            const mainItems = mergedItems.filter(i => !i.article.toUpperCase().startsWith('F07-'));
            const f07Items = mergedItems.filter(i => i.article.toUpperCase().startsWith('F07-'));

            const drawTablePage = (items, isF07Mode) => {
                doc.setFontSize(22); doc.setTextColor(220, 38, 38); doc.setFont('times', 'bold');
                doc.text('PESANAN ONLINE FARADELA OFFICIAL', 105, 18, { align: 'center' });
                doc.setFontSize(16); doc.setTextColor(220, 38, 38); doc.setFont('times', 'italic');
                doc.text(dateText, 105, 27, { align: 'center' });
                const textWidth = doc.getTextWidth(dateText);
                doc.setDrawColor(220, 38, 38); doc.setLineWidth(0.8);
                doc.rect(105 - (textWidth / 2) - 5, 20.5, textWidth + 10, 9);

                const tableData = []; let totalAll = 0;
                items.forEach((item) => {
                    let displayArt = item.article;
                    if (isF07Mode && displayArt.toUpperCase().startsWith('F07-')) {
                        displayArt = displayArt.substring(4).replace(/^0+/, '').replace(/\.\d+$/, '');
                    }
                    tableData.push([displayArt, item.colorName, item.sizeName, item.missingQty.toString(), item.isUrgent]);
                    totalAll += item.missingQty;
                });
                tableData.push(['TOTAL', '', '', totalAll.toString(), false]);

                doc.autoTable({
                    startY: 40,
                    head: [['ARTICLE', 'COLOUR', 'SIZE', 'JUMLAH']],
                    body: tableData.map(r => r.slice(0, 4)),
                    theme: 'grid',
                    styles: { font: 'times', fontSize: 13, halign: 'center', valign: 'middle', lineColor: 0, lineWidth: 0.5 },
                    headStyles: { fillColor: [226, 239, 218], fontStyle: 'bold', textColor: 0 },
                    didParseCell: (data) => {
                        if (data.section === 'body') {
                            const row = tableData[data.row.index];
                            if (data.row.index === tableData.length - 1) {
                                data.cell.styles.fontStyle = 'bold'; data.cell.styles.fontSize = 16;
                                if (data.column.index === 3) data.cell.styles.textColor = [220, 38, 38];
                                if (data.column.index === 0) { data.cell.colSpan = 3; data.cell.styles.halign = 'center'; }
                            } else if (row && row[4]) {
                                data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = 'bold';
                            }
                        }
                    }
                });
            };

            if (mainItems.length > 0) drawTablePage(mainItems, false);
            if (f07Items.length > 0) { if (mainItems.length > 0) doc.addPage(); drawTablePage(f07Items, true); }

            const pdfBlobUrl = doc.output('bloburl');
            window.open(pdfBlobUrl, '_blank');

            // OPTIONAL: Release lock for associated QC orders if re-printed
            try {
                const batchDel = window.db.batch();
                const qcSnap = await window.db.collection('qc_orders').where('poDate', '==', batch.targetDate).where('session', '==', batch.session).where('isReleasedToProduction', '==', false).get();
                qcSnap.forEach(d => batchDel.update(d.ref, { isReleasedToProduction: true, poReleasedTimestamp: Date.now() }));
                await batchDel.commit();
            } catch (e) { }

            showToast('success', 'Berhasil Re-print SPO!');
        } catch (e) {
            showToast('error', 'Gagal re-print PDF.');
            console.error(e);
        }
        setIsLoading(false);
    };

    // FUNGSI RIWAYAT: RE-PRINT LABELS
    // FUNGSI RIWAYAT: RE-PRINT RESI EKSPEDISI (Memerlukan Memory Cache)
    const handleRePrintResi = async (batch, filterType = 'all') => {
        let sessionMemory = window.pdfTrackingCache && window.pdfTrackingCache[batch.id];
        
        // JIKA MEMORY KOSONG, COBA DOWNLOAD DARI CLOUDINARY
        if (!sessionMemory || !sessionMemory.pdfTrackingData || sessionMemory.pdfTrackingData.length === 0) {
            if (batch.pdfUrls && batch.pdfUrls.length > 0 && batch.pdfTrackingInfo) {
                showToast('info', 'Mengunduh PDF dari Cloudinary, mohon tunggu...', 3000);
                setIsGeneratingPdf(true);
                try {
                    const downloadedFiles = {};
                    for (const urlObj of batch.pdfUrls) {
                        const response = await fetch(urlObj.url);
                        const arrayBuffer = await response.arrayBuffer();
                        downloadedFiles[urlObj.name] = arrayBuffer;
                    }

                    const reconstructedTracking = batch.pdfTrackingInfo.map(info => ({
                        resi: info.resi,
                        platform: info.platform,
                        pageIndex: info.pageIndex,
                        file: { name: info.fileName },
                        uniqueFileName: info.fileName,
                        arrayBuffer: downloadedFiles[info.fileName],
                        itemStatus: info.itemStatus || null
                    }));

                    sessionMemory = {
                        pdfTrackingData: reconstructedTracking
                    };

                    if (!window.pdfTrackingCache) window.pdfTrackingCache = {};
                    window.pdfTrackingCache[batch.id] = sessionMemory;

                } catch (e) {
                    setIsGeneratingPdf(false);
                    return showToast('error', 'Gagal mengunduh PDF dari Cloud: ' + e.message);
                }
            } else {
                return showToast('error', 'Data PDF asli dari sesi ini sudah tidak tersedia.');
            }
        }

        const { pdfTrackingData } = sessionMemory;

        // Filter data yang akan dicetak
        let filteredTracking = pdfTrackingData;
        
        // Logika untuk READY TERAKHIR
        let excludeResiSet = new Set();
        if (filterType === 'ready_latest') {
            const prevBatch = onlineHistory.find(h => 
                h.targetDate === batch.targetDate && 
                h.session === batch.session && 
                new Date(h.savedAt) < new Date(batch.savedAt)
            );
            if (prevBatch && prevBatch.pdfTrackingInfo) {
                prevBatch.pdfTrackingInfo.forEach(t => excludeResiSet.add(t.resi));
            }
        }

        if (filterType !== 'all') {
            // Cek apakah data punya embedded itemStatus (data baru) atau tidak (data lama)
            const hasEmbeddedStatus = pdfTrackingData.some(t => t.itemStatus);

            if (hasEmbeddedStatus) {
                // STRATEGI UTAMA: Gunakan itemStatus yang sudah tersimpan di pdfTrackingInfo
                // Ini tidak perlu query ke qc_orders sama sekali (anti-gagal)
                filteredTracking = pdfTrackingData.filter(track => {
                    if (filterType === 'ready' || filterType === 'ready_latest') {
                        if (track.itemStatus !== 'READY') return false;
                        if (filterType === 'ready_latest' && excludeResiSet.has(track.resi)) return false;
                        return true;
                    }
                    if (filterType === 'po') return track.itemStatus === 'PO';
                    return true;
                });
            } else {
                // STRATEGI FALLBACK: Untuk data lama tanpa itemStatus, query qc_orders
                try {
                    let sessionQcOrders = [];
                    const qcSnap = await window.db.collection('qc_orders')
                        .where('poDate', '==', batch.targetDate)
                        .where('session', '==', batch.session)
                        .get();
                    sessionQcOrders = qcSnap.docs.map(d => ({id: d.id, ...d.data()}));

                    if (sessionQcOrders.length === 0) {
                        const riwayatSnap = await window.db.collection('riwayat_qc')
                            .where('poDate', '==', batch.targetDate)
                            .where('session', '==', batch.session)
                            .get();
                        if (!riwayatSnap.empty) {
                            sessionQcOrders = riwayatSnap.docs.map(d => ({id: d.id, ...d.data()}));
                        }
                    }

                    if (sessionQcOrders.length > 0) {
                        filteredTracking = pdfTrackingData.filter(track => {
                            const order = sessionQcOrders.find(o =>
                                o.id === track.resi ||
                                o.awb === track.resi ||
                                (o.items && o.items[0] && o.items[0].originalOrderId === track.resi)
                            );
                            if (!order) return false;
                            const isPO = (order.items || []).some(it => it.status === 'PO' || it.status === 'UNRECOGNIZED');
                            if (filterType === 'ready' || filterType === 'ready_latest') {
                                if (isPO) return false;
                                if (filterType === 'ready_latest' && excludeResiSet.has(track.resi)) return false;
                                return true;
                            }
                            if (filterType === 'po') return isPO;
                            return true;
                        });
                    }
                    // Jika sessionQcOrders kosong, filteredTracking tetap = pdfTrackingData (cetak semua)
                } catch (queryErr) {
                    console.warn('Gagal query QC orders untuk filter, cetak semua:', queryErr);
                    // Jika query gagal, cetak semua resi
                }
            }
        }

        if (filteredTracking.length === 0) {
            setIsGeneratingPdf(false);
            return showToast('error', 'Tidak ada resi ekspedisi untuk kategori yang dipilih.');
        }

        setIsGeneratingPdf(true);
        showToast('info', `Sedang menyusun PDF Resi Berurutan (${filterType.toUpperCase()}), mohon tunggu...`, 3000);

        try {
            const { PDFDocument } = PDFLib;
            const mergedPdf = await PDFDocument.create();
            const loadedFilesCache = new Map();

            for (const track of filteredTracking) {
                try {
                    const fileName = track.uniqueFileName || track.file.name;
                    let srcDoc;

                    if (loadedFilesCache.has(fileName)) {
                        srcDoc = loadedFilesCache.get(fileName);
                    } else {
                        const arrayBuffer = track.arrayBuffer ? track.arrayBuffer : await track.file.arrayBuffer();
                        srcDoc = await PDFDocument.load(arrayBuffer);
                        loadedFilesCache.set(fileName, srcDoc);
                    }

                    const [copiedPage] = await mergedPdf.copyPages(srcDoc, [track.pageIndex]);
                    mergedPdf.addPage(copiedPage);
                } catch (pageErr) {
                    console.error(`Gagal memproses resi ${track.resi} halaman ${track.pageIndex}:`, pageErr);
                }
            }

            const pdfBytes = await mergedPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `Resi_Berurutan_${filterType.toUpperCase()}_${dateStr}.pdf`;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            showToast('success', 'PDF Resi Berurutan berhasil diunduh!');
        } catch (error) {
            console.error("Error generating sorted PDF:", error);
            showToast('error', 'Terjadi kesalahan saat membuat PDF.');
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    // FUNGSI RIWAYAT: RE-PRINT LABELS PRODUKSI
    const handleRePrintLabels = (batch) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return showToast('error', 'Gagal membuka tab baru. Izinkan Pop-up Blocker!');

        let printList = [];
        const printDate = batch.targetDate;
        const sessionCodeInt = batch.session || 1;

        (batch.items || []).forEach(item => {
            const matchedVariant = variants.find(v => v.sku === (item.sku || item.sysSku)) || 
                                   variants.find(v => String(v.article).trim().toUpperCase() === String(item.article).trim().toUpperCase() && 
                                                      String(v.colorName).trim().toUpperCase() === String(item.colorName).trim().toUpperCase() && 
                                                      String(v.sizeName).trim().toUpperCase() === String(item.sizeName).trim().toUpperCase());
            for (let i = 0; i < (item.missingQty || 0); i++) {
                printList.push({
                    article: item.article, colorName: item.colorName, sizeName: item.sizeName,
                    printDate, sessionCodeInt,
                    sku: matchedVariant ? matchedVariant.sku : `${item.article}-${item.colorName}-${item.sizeName}`,
                    photo: matchedVariant ? matchedVariant.photo : '',
                    sellPrice: matchedVariant ? matchedVariant.sellPrice : 0
                });
            }
        });

        const getProductionCode = (dateString) => {
            if (!dateString) return "";
            const parts = dateString.split('T')[0].split('-');
            const mapChar = (char) => ({ '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', '6': 'F', '7': 'G', '8': 'H', '9': 'I', '0': 'J' }[char] || char);
            return `${parts[0].slice(-2).split('').map(mapChar).join('')}-${parseInt(parts[1], 10).toString().split('').map(mapChar).join('')}`;
        };

        let htmlContent = `
              <!DOCTYPE html><html><head><title>Label SPO - ${batch.id}</title>
                <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
                <style>
                  @page { margin: 0; }
                  body { margin: 0; padding: 0; font-family: sans-serif; background-color: white; }
                  .label-container { width: 471px; height: 215px; margin: 5px; padding: 0; border: none; box-sizing: border-box; page-break-after: always; page-break-inside: avoid; overflow: hidden; background-color: white; display: flex; justify-content: center; align-items: center; }
                  .label-grid { width: 100%; height: 100%; border: 2px solid black; display: grid; grid-template-columns: 1.4fr 2.4fr 0.9fr; grid-template-rows: 1fr 1fr; box-sizing: border-box; position: relative; }
                  .cell { display: flex; justify-content: center; align-items: center; padding: 5px; box-sizing: border-box; text-align: center; overflow: hidden; }
                  .br { border-right: 1px solid black; } .bb { border-bottom: 1px solid black; }
                  .photo { max-width: 100%; max-height: 100%; object-fit: contain; }
                  .barcode-svg { max-width: 100%; max-height: 100%; }
                  .size-text { font-size: 50px; font-weight: 900; line-height: 1; margin-bottom: 2px; }
                  .color-text { font-size: 16px; font-weight: bold; text-transform: uppercase; margin-top: 2px; }
                  .prod-container { display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; }
                  .prod-code { font-size: 34px; font-weight: 900; letter-spacing: 1px; }
                  .prod-session { font-size: 30px; font-weight: 900; letter-spacing: 1px; }
                  .article-text { font-size: 20px; font-weight: 900; }
                  .price-text { font-size: 14px; font-weight: bold; margin-top: 4px; }
                  .date-marker { position: absolute; top: 2px; left: 2px; font-size: 20px; font-weight: 900; color: white; background: black; padding: 2px 8px; border-radius: 4px; z-index: 20; text-transform: uppercase; }
                </style></head><body>
            `;

        printList.forEach(item => {
            const matchedVariant = variants.find(v => v.sku === item.sku);
            const fullBarcode = buildShortBarcode(matchedVariant || item, item.printDate, 'ONLINE', item.sessionCodeInt);
            const prodCode = getProductionCode(item.printDate);
            const photoHtml = item.photo ? `<img class="photo" src="${item.photo}" />` : `<div style="font-size:10px;">No Img</div>`;
            const dateMarkerText = item.printDate.split('-')[2]; // Hanya tanggal (DD)

            htmlContent += `
                <div class="label-container">
                  <div class="label-grid">
                    <div class="cell br bb" style="position: relative;">
                      <div class="date-marker">${dateMarkerText}</div>
                      ${photoHtml}
                    </div>
                    <div class="cell br bb" style="flex-direction: column; padding: 10px;"><svg class="barcode-svg" jsbarcode-value="${fullBarcode}" jsbarcode-format="CODE128" jsbarcode-width="2" jsbarcode-height="55" jsbarcode-displayvalue="false" jsbarcode-margin="0"></svg></div>
                    <div class="cell bb"><div class="prod-container"><div class="prod-code">${prodCode}-</div><div class="prod-session">${item.sessionCodeInt}</div></div></div>
                    <div class="cell br" style="flex-direction: column;"><div class="size-text">${item.sizeName}</div><div class="color-text">${item.colorName}</div></div>
                    <div class="cell br" style="flex-direction: column;"><div class="article-text">${item.article}</div><div class="price-text">Rp. ${Number(item.sellPrice || 0).toLocaleString('id-ID')}</div></div>
                    <div class="cell"><div class="qrcode-target" data-value="${fullBarcode}"></div></div>
                  </div>
                </div>
              `;
        });

        htmlContent += `
                <script>
                  window.onload = function() {
                    if(window.JsBarcode) JsBarcode(".barcode-svg").init();
                    if(window.QRCode) {
                       document.querySelectorAll('.qrcode-target').forEach(function(el) { new QRCode(el, { text: el.getAttribute('data-value'), width: 70, height: 70 }); });
                    }
                    setTimeout(() => { window.print(); }, 800);
                  };
                <\/script></body></html>
            `;
        printWindow.document.open(); printWindow.document.write(htmlContent); printWindow.document.close();
    };

    const handleDeleteHistory = async (id) => {
        if (!window.confirm('Hapus riwayat permanen dari daftar riwayat dan produksi?')) return;
        setIsLoading(true);
        try {
            const docSnap = await window.db.collection('online_history').doc(id).get();
            if (!docSnap.exists) {
                setIsLoading(false);
                return showToast('error', 'Riwayat tidak ditemukan');
            }
            const data = docSnap.data();
            const { targetDate, session } = data;

            const batchDelete = window.db.batch();
            batchDelete.delete(window.db.collection('online_history').doc(id));

            // Kita biarkan Cloudinary menghandle file secara mandiri.
            // Karena kapasitas gratis 25GB, file PDF tidak akan memakan banyak ruang (1 PDF ~500kb).

            // Cari pesanan QC yang terkait (Tanggal & Sesi) agar sinkron dengan Dashboard Produksi
            const qcSnap = await window.db.collection('qc_orders')
                .where('poDate', '==', targetDate)
                .where('session', '==', session)
                .get();

            qcSnap.forEach(doc => {
                batchDelete.delete(doc.ref);
            });

            await batchDelete.commit();
            await loadOnlineHistory();
            showToast('success', 'Riwayat dan Antrean Produksi berhasil dihapus!');
        } catch (e) {
            showToast('error', 'Gagal hapus: ' + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    // ==========================================
    // FITUR BARU: HAPUS / RESET ANTRIAN PO DRAFT
    // ==========================================
    const handleHapusAntrianPO = async () => {
        if (poDrafts.length === 0) return showToast('error', 'Tidak ada antrian PO untuk dihapus.');

        // LOGIKA BARU: Cek Izin Akses Hapus Antrean (Admin atau Akses Khusus)
        const isAuthorized = currentUser?.role === 'admin' || (currentUser?.access || []).includes('delete_antrean');
        if (!isAuthorized) {
            return showToast('error', 'Maaf, Anda tidak memiliki akses untuk menghapus antrean PO.');
        }

        const confirmed = window.confirm(`PERINGATAN!\n\nAnda akan menghapus SEMUA antrian PO (${poDrafts.length} batch) yang belum dikirim ke produksi.\nTindakan ini tidak bisa dibatalkan!\n\nYakin ingin mereset/menghapus antrian ini?`);
        if (!confirmed) return;

        setPoDraftLoading(true);
        try {
            const batchDel = db.batch();
            poDrafts.forEach(d => batchDel.delete(db.collection('po_drafts').doc(d.id)));
            await batchDel.commit();

            await loadPODrafts(); // Refresh data
            setDraftPdfTrackingData([]); // Kosongkan akumulasi PDF
            showToast('success', 'Antrian PO berhasil dihapus/direset!');
        } catch (e) {
            showToast('error', 'Gagal menghapus antrian PO.');
            console.error(e);
        }
        setPoDraftLoading(false);
    };

    const handleUploadShopee = (e) => {
        const newFiles = Array.from(e.target.files).filter(f => !shopeeFiles.map(x => x.name).includes(f.name));
        setShopeeFiles(prev => [...prev, ...newFiles]);
        setShowResiPreview(false); // Reset preview saat file upload baru
        if (shopeeRef.current) shopeeRef.current.value = '';
    };
    const handleUploadTiktok = (e) => {
        const newFiles = Array.from(e.target.files).filter(f => !tiktokFiles.map(x => x.name).includes(f.name));
        setTiktokFiles(prev => [...prev, ...newFiles]);
        setShowResiPreview(false); // Reset preview saat file upload baru
        if (tiktokRef.current) tiktokRef.current.value = '';
    };
    const handleUploadAffiliateTiktok = (e) => {
        const newFiles = Array.from(e.target.files).filter(f => !affiliateTiktokFiles.map(x => x.name).includes(f.name));
        setAffiliateTiktokFiles(prev => [...prev, ...newFiles]);
        setShowResiPreview(false);
    };
    const handleUploadLazada = (e) => {
        const newFiles = Array.from(e.target.files).filter(f => !lazadaFiles.map(x => x.name).includes(f.name));
        setLazadaFiles(prev => [...prev, ...newFiles]);
        setShowResiPreview(false); // Reset preview saat file upload baru
        if (lazadaRef.current) lazadaRef.current.value = '';
    };

    const extractTextFromPDF = async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(item => item.str).join(' ') + '\n';
        }
        return fullText;
    };

    const processAllPlatforms = async () => {
        if (shopeeFiles.length === 0 && tiktokFiles.length === 0 && lazadaFiles.length === 0 && affiliateTiktokFiles.length === 0 && !includeManual) {
            return showToast('error', 'Masukkan minimal 1 file atau pilih pesanan manual!');
        }
        setIsLoadingLocal(true);
        setPlatformStats(null);

        try {
            let shResi = 0, shPcs = 0, tkResi = 0, tkPcs = 0, lzResi = 0, lzPcs = 0;
            let affTkResi = 0, affTkPcs = 0;
            const today = new Date(); today.setHours(0, 0, 0, 0);

            // Base SKU harus minimal 2 karakter agar kode routing seperti '3-JNE-00' tidak ikut terbaca
            // PERBAIKAN: Menambahkan dukungan untuk garis strip di dalam nama warna (misal: Abu-abu)
            const robustSkuPattern = '([A-Z0-9]{2,}(?:[\\.\\-][A-Z0-9]+)*-[A-Za-z\\s\\-]+-\\d{2,})';
            let extractedOrders = {};
            let tempPdfTracking = []; // Untuk cetak PDF berurutan

            const addToExtracted = (resi, platform, sku, qty, shipDateObj) => {
                if (!extractedOrders[resi]) {
                    // PERBAIKAN: Simpan shipDateObj (Batas Kirim) ke dalam array
                    extractedOrders[resi] = { id: resi, platform, dateAdded: new Date().toISOString(), items: [], shipDate: shipDateObj };
                }
                const existingItem = extractedOrders[resi].items.find(i => i.sku === sku);
                if (existingItem) existingItem.qty += qty;
                else extractedOrders[resi].items.push({ sku: sku.toUpperCase(), qty, scanned: 0, status: 'READY', defect: 0 });
            };

            // 1. SHOPEE (PDF Seller Centre)
            const shopeeResiSet = new Set();
            for (let file of shopeeFiles) {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const rawPageText = content.items.map(item => item.str).join(' ');

                    // Bersihkan SELURUH halaman: gabungkan SKU yang terpotong akibat line-wrap
                    // Contoh: 'F07-06.1- Hitam-36' -> 'F07-06.1-Hitam-36'
                    const pageText = rawPageText.replace(/([A-Za-z0-9.])-\s+([A-Za-z0-9])/g, '$1-$2');

                    // Deteksi label Shopee dari teks halaman
                    const hasOrder = pageText.match(/No\.?\s*Pesanan/i) || pageText.match(/Batas\s*Kirim/i) || pageText.match(/Resi\s*:/i);
                    if (!hasOrder) continue;

                    // Cari Batas Kirim di halaman
                    let shipDate = null;
                    const dateMatch = pageText.match(/Batas\s*Kirim\s*:?\s*(\d{2})[-/](\d{2})[-/](\d{4})/i);
                    if (dateMatch) shipDate = new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T00:00:00`);

                    // PERBAIKAN: Hanya baca SKU dari area TABEL PRODUK (setelah kolom "SKU")
                    // Ini mencegah kode routing/header (PEE4-MH-02, CLK-A-03, dll) ikut terbaca
                    let skuAreaText = pageText;
                    const skuHeaderIdx = pageText.search(/\bSKU\b/i);
                    if (skuHeaderIdx !== -1) {
                        // Ambil teks mulai dari keyword "SKU" sampai akhir (area tabel produk ke bawah)
                        skuAreaText = pageText.substring(skuHeaderIdx);
                        // Potong di keyword "Pesan:" agar tidak membaca barcode resi di bawah tabel
                        const pesanIdx = skuAreaText.search(/Pesan\s*:\s*\(/i);
                        if (pesanIdx !== -1) {
                            skuAreaText = skuAreaText.substring(0, pesanIdx);
                        }
                    }

                    const robustSkuPatternRegex = new RegExp('([A-Z0-9]{2,}(?:[\\.\\-][A-Z0-9]+)*-[A-Za-z\\s]+-\\d{2,})', 'gi');
                    let itemsOnPage = [];
                    let match;

                    while ((match = robustSkuPatternRegex.exec(skuAreaText)) !== null) {
                        const sku = match[1].trim().toUpperCase();

                        // Filter out invalid routing codes, but keep legitimate 3-part SKUs
                        const parts = sku.split('-');
                        if (parts.length < 3) continue;
                        if (parts.length === 3 && (parts[1].length < 2 || isNaN(parts[2]))) continue;
                        if (parts.length > 3 && !parts.slice(1).every(p => p.length >= 2)) continue;

                        // Cari Qty tepat setelah SKU ini ditemukan (Batas 40 karakter ke depan)
                        const searchArea = skuAreaText.substring(robustSkuPatternRegex.lastIndex, robustSkuPatternRegex.lastIndex + 40);

                        // Pola: " [Variasi] [Qty] " -> Cari angka sendirian sebelum batas kata (Pesan: / SPXID)
                        const qtyMatch = searchArea.match(/(?:^|\s|,)[A-Za-z\s.,\-]*?\s+(\d{1,3})(?=\s|$|Pesan|SPXID|#)/i);

                        let itemQty = 1; // Default jika gagal nemu angka
                        // Pengecekan ekstra: pastikan qtyMatch[1] masuk akal (bukan ratusan/ribuan, karena Qty sepatu sangat jarang > 20)
                        if (qtyMatch && qtyMatch[1] && parseInt(qtyMatch[1], 10) <= 50) {
                            itemQty = parseInt(qtyMatch[1], 10);
                        }

                        const existing = itemsOnPage.find(i => i.sku === sku);
                        if (existing) {
                            existing.qty += itemQty;
                        } else {
                            itemsOnPage.push({ sku, qty: itemQty });
                        }
                    }

                    // Cari NOMOR RESI Shopee (format: Resi:SPXIDXXX atau SPXIDXXX di barcode samping)
                    // Ini yang di-scan saat QC/handover kurir - BUKAN No.Pesanan
                    const resiMatches = [...rawPageText.matchAll(/(?:Resi\s*:?\s*)([A-Z]+ID[A-Z0-9]{10,})/gi)];
                    const pageResiList = [...new Set(resiMatches.map(m => m[1].toUpperCase()))];

                    // Fallback: gunakan No.Pesanan jika tidak ada kode SPXID/resi kurir
                    if (pageResiList.length === 0) {
                        const pesananMatches = [...pageText.matchAll(/No\.?\s*Pesanan\s*:?\s*([A-Z0-9]+)/gi)];
                        pesananMatches.forEach(m => pageResiList.push(m[1].toUpperCase()));
                    }
                    if (pageResiList.length === 0 || itemsOnPage.length === 0) continue;

                    let pageTracked = false;

                    pageResiList.forEach(trackingNumber => {
                        if (!shopeeResiSet.has(trackingNumber)) {
                            shResi++;
                            shopeeResiSet.add(trackingNumber);
                            itemsOnPage.forEach(item => {
                                shPcs += item.qty;
                                addToExtracted(trackingNumber, 'SHOPEE', item.sku, item.qty, shipDate);
                            });
                            if (!pageTracked) {
                                tempPdfTracking.push({ file, pageIndex: i - 1, resi: trackingNumber, platform: 'SHOPEE', uniqueFileName: `${file.name}_${file.size}` });
                                pageTracked = true;
                            }
                        }
                    });
                }
            }

            // 2. TIKTOK
            for (let file of tiktokFiles) {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map(item => item.str).join(' ');

                    if (pageText.match(/Order Id/i) || pageText.match(/In transit by/i)) {
                        tkResi++;
                        let shipDate = null;
                        const dateMatch = pageText.match(/In transit by:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
                        if (dateMatch) shipDate = new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T00:00:00`);

                        // Nomor resi kurir TikTok (yang tersimpan di QR code label)
                        // Priority 1: J&T/Anteraja/dll. ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ 2 huruf + 8-14 digit (misal: JX7594453952)
                        const letterCodeMatch = pageText.match(/\b([A-Z]{2}\d{8,14})\b/i);
                        // Priority 2: SiCepat/dll. -> 10-14 digit murni di bagian atas label (header)
                        const hdrEnd = pageText.search(/Dari\s*\(pengirim\)|Pengirim\s*:/i);
                        const hdrSection = hdrEnd > 10 ? pageText.slice(0, hdrEnd) : pageText.slice(0, 350);
                        const digitCodeMatch = !letterCodeMatch ? hdrSection.match(/\b(\d{10,14})\b/) : null;
                        // Priority 3: TT Order ID sebagai fallback terakhir
                        const orderIdMatch = pageText.match(/(?:TT\s*Order\s*ID|Order\s*Id)\s*:?\s*([\d]+)/i);
                        const orderId = (letterCodeMatch ? letterCodeMatch[1] : null) ||
                            (digitCodeMatch ? digitCodeMatch[1] : null) ||
                            (orderIdMatch ? orderIdMatch[1] : `TT-UNKNOWN-${Math.random().toString(36).substr(2, 6)}`);

                        const skuMatches = [...pageText.matchAll(new RegExp(robustSkuPattern, 'gi'))];
                        if (skuMatches.length > 0) {
                            const uniqueSkus = new Set(skuMatches.map(m => m[1].trim()));
                            uniqueSkus.forEach(sku => {
                                const escapedSku = sku.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                                const qtyRegex = new RegExp(escapedSku + `\\s*["']?\\s*,?\\s*["']?\\s*(\\d+)`, 'i');
                                const qtyMatch = pageText.match(qtyRegex);
                                let qty = 1;
                                if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
                                tkPcs += qty;
                                addToExtracted(orderId, 'TIKTOK', sku, qty, shipDate);
                            });
                        }
                        tempPdfTracking.push({ file, pageIndex: i - 1, resi: orderId, platform: 'TIKTOK', uniqueFileName: `${file.name}_${file.size}` });
                    }
                }
            }

            // 2b. AFFILIATE TIKTOK
            for (let file of affiliateTiktokFiles) {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map(item => item.str).join(' ');

                    if (pageText.match(/Order Id/i) || pageText.match(/In transit by/i)) {
                        affTkResi++;
                        let shipDate = null;
                        const dateMatch = pageText.match(/In transit by:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
                        if (dateMatch) shipDate = new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T00:00:00`);

                        const letterCodeMatch = pageText.match(/\b([A-Z]{2}\d{8,14})\b/i);
                        const hdrEnd = pageText.search(/Dari\s*\(pengirim\)|Pengirim\s*:/i);
                        const hdrSection = hdrEnd > 10 ? pageText.slice(0, hdrEnd) : pageText.slice(0, 350);
                        const digitCodeMatch = !letterCodeMatch ? hdrSection.match(/\b(\d{10,14})\b/) : null;
                        const orderIdMatch = pageText.match(/(?:TT\s*Order\s*ID|Order\s*Id)\s*:?\s*([\d]+)/i);
                        const orderId = (letterCodeMatch ? letterCodeMatch[1] : null) ||
                            (digitCodeMatch ? digitCodeMatch[1] : null) ||
                            (orderIdMatch ? orderIdMatch[1] : `TT-AFF-UNKNOWN-${Math.random().toString(36).substr(2, 6)}`);

                        const skuMatches = [...pageText.matchAll(new RegExp(robustSkuPattern, 'gi'))];
                        if (skuMatches.length > 0) {
                            const uniqueSkus = new Set(skuMatches.map(m => m[1].trim()));
                            uniqueSkus.forEach(sku => {
                                const escapedSku = sku.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                                const qtyRegex = new RegExp(escapedSku + `\\s*["']?\\s*,?\\s*["']?\\s*(\\d+)`, 'i');
                                const qtyMatch = pageText.match(qtyRegex);
                                let qty = 1;
                                if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
                                affTkPcs += qty;
                                addToExtracted(orderId, 'AFFILIATE_TIKTOK', sku, qty, shipDate);
                            });
                        }
                        tempPdfTracking.push({ file, pageIndex: i - 1, resi: orderId, platform: 'AFFILIATE_TIKTOK', uniqueFileName: `${file.name}_${file.size}` });
                    }
                }
            }

            // 3. LAZADA
            for (let file of lazadaFiles) {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map(item => item.str).join(' ');

                    if (pageText.match(/LXAD-/i) || pageText.match(/Penerima/i) || pageText.match(/Lazada/i)) {
                        lzResi++;
                        // Cari resi: support LXAD (Lazada sendiri) dan JNAP/JNE untuk kurir JNE
                        const resiMatch = pageText.match(/(LXAD-\d+|JNAP-[\w]+)/i);
                        const orderId = resiMatch ? resiMatch[0].toUpperCase() : `LZD-UNKNOWN-${Math.random().toString(36).substr(2, 6)}`;

                        // Batas kirim Lazada = tanggal di label + 1 hari
                        let shipDate = null;
                        const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, aug: 7, agu: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, des: 11 };
                        const lzDateMatch = pageText.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Mei|Jun|Jul|Aug|Agu|Sep|Oct|Okt|Nov|Dec|Des)\s+(\d{4})/i);
                        if (lzDateMatch) {
                            const d = new Date(parseInt(lzDateMatch[3]), monthMap[lzDateMatch[2].toLowerCase()], parseInt(lzDateMatch[1]));
                            d.setDate(d.getDate() + 1); // Batas kirim = hari berikutnya
                            shipDate = d;
                        }

                        const lazadaRegex = new RegExp(`(\\d+)\\s*["']?\\s*,\\s*["']?\\s*` + robustSkuPattern, 'gi');
                        let match; let foundAny = false;
                        while ((match = lazadaRegex.exec(pageText)) !== null) {
                            let qty = parseInt(match[1], 10);
                            let sku = match[2].trim();
                            lzPcs += qty;
                            addToExtracted(orderId, 'LAZADA', sku, qty, shipDate);
                            foundAny = true;
                        }

                        if (!foundAny) {
                            const skuMatches = [...pageText.matchAll(new RegExp(robustSkuPattern, 'gi'))];
                            if (skuMatches.length > 0) {
                                const uniqueSkus = new Set(skuMatches.map(m => m[1].trim()));
                                uniqueSkus.forEach(sku => {
                                    const escapedSku = sku.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                                    const qtyRegex = new RegExp(`(\\d+)\\s*["']?\\s*,?\\s*["']?\\s*` + escapedSku, 'i');
                                    const qtyMatch = pageText.match(qtyRegex);
                                    let qty = 1; if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
                                    lzPcs += qty;
                                    addToExtracted(orderId, 'LAZADA', sku, qty, shipDate);
                                });
                            }
                        }
                        tempPdfTracking.push({ file, pageIndex: i - 1, resi: orderId, platform: 'LAZADA', uniqueFileName: `${file.name}_${file.size}` });
                    }
                }
            }

            // --- INJECT PESANAN MANUAL ---
            let mnResi = 0, mnPcs = 0;
            if (includeManual) {
                const drafts = manualOrders.filter(o => o.status === 'draft');
                setIncludedManualOrderIds(drafts.map(d => d.id));

                // Fungsi helper untuk bikin PDF blob dari Resi Manual
                const createManualPdfBlob = async (order, variants) => {
                    await loadJsPdf(); // Pastikan library jsPDF termuat
                    return new Promise((resolve) => {
                        const { jsPDF } = window.jspdf;
                        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: [100, 150] });

                        const dateStr = new Date(order.createdAt || Date.now()).toISOString().split('T')[0];
                        const timeStr = new Date(order.createdAt || Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

                        doc.setFontSize(16); doc.setFont('helvetica', 'bold');
                        doc.text('FARADELA OFFICIAL', 4, 8);
                        doc.setFontSize(8); doc.setFont('helvetica', 'normal');
                        doc.text(`${dateStr} | ${timeStr}`, 96, 8, { align: 'right' });
                        doc.setLineWidth(0.5); doc.line(4, 10, 96, 10);

                        doc.setFontSize(10);
                        doc.text(`LAYANAN: ${order.layanan}`, 4, 15);
                        doc.text(`EKSPEDISI: ${order.ekspedisi}`, 50, 15);

                        doc.rect(4, 18, 92, 16);

                        const finishPdf = () => {
                            doc.setFontSize(8); doc.text('NO. PESANAN:', 24, 23);
                            doc.setFontSize(12); doc.setFont('helvetica', 'bold');
                            doc.text(order.id_pesanan, 24, 28);
                            const sumberTxt = (order.sumber || '').toUpperCase();
                            doc.setFontSize(8); doc.setFillColor(238, 238, 238);
                            doc.rect(24, 30, doc.getTextWidth(sumberTxt) + 2, 3.5, 'F');
                            doc.text(sumberTxt, 25, 33);

                            doc.setDrawColor(0); doc.rect(4, 36, 92, 50);
                            doc.setFillColor(238, 238, 238); doc.rect(4, 36, 92, 5, 'F');
                            doc.setFontSize(8); doc.text('Penerima:', 6, 39.5);
                            doc.setFontSize(12); doc.text(order.nama_penerima, 6, 45);
                            doc.setFontSize(10); doc.text(order.nomor_telepon || '-', 6, 50);
                            doc.setFontSize(9); doc.setFont('helvetica', 'normal');
                            const splitAddress = doc.splitTextToSize(order.alamat, 88);
                            doc.text(splitAddress, 6, 54);

                            const pengirimYPos = 68;
                            doc.setFillColor(249, 249, 249); doc.rect(4, pengirimYPos, 92, 18, 'F');
                            doc.setFillColor(238, 238, 238); doc.rect(4, pengirimYPos, 92, 5, 'F');
                            doc.text('Pengirim:', 6, pengirimYPos + 3.5);

                            doc.setFontSize(10); doc.setFont('helvetica', 'bold');
                            doc.text(order.nama_pengirim || 'FARADELA OFFICIAL', 6, pengirimYPos + 9);
                            doc.setFontSize(8); doc.setFont('helvetica', 'normal');
                            doc.text(`Handphone: ${order.telepon_pengirim || '-'}`, 6, pengirimYPos + 13);
                            if (order.alamat_pengirim) doc.text(order.alamat_pengirim.substring(0, 50), 6, pengirimYPos + 16);

                            doc.setLineDashPattern([2, 2], 0); doc.line(4, 88, 96, 88); doc.setLineDashPattern([], 0);

                            doc.setFontSize(9); doc.setFont('helvetica', 'bold');
                            const totalQty = order.list_produk.reduce((a, c) => a + c.qty, 0);
                            doc.text(`RINCIAN PAKET (${totalQty} PCS)`, 50, 93, { align: 'center' });

                            doc.autoTable({
                                startY: 95, margin: { left: 4 }, tableWidth: 92,
                                head: [['Nama Produk / Sku', 'Qty']],
                                body: order.list_produk.map(item => {
                                    const v = variants.find(x => x.sku === item.sku);
                                    return [`${v ? v.article : item.sku} | ${v ? v.colorName : '-'} (Sz: ${v ? v.sizeName : '-'})`, item.qty];
                                }),
                                theme: 'grid', styles: { fontSize: 8, cellPadding: 1, font: 'helvetica' },
                                headStyles: { fillColor: [238, 238, 238], textColor: 0, fontStyle: 'bold' },
                                columnStyles: { 0: { cellWidth: 72 }, 1: { cellWidth: 20, halign: 'center' } }
                            });

                            const buffer = doc.output('arraybuffer');
                            const pBlob = new Blob([buffer], { type: 'application/pdf' });
                            pBlob.name = 'Manual_' + order.id_pesanan + '.pdf';
                            pBlob.arrayBuffer = () => Promise.resolve(buffer); // Compatible dengan pdf-lib tracking
                            resolve(pBlob);
                        };

                        if (window.QRCode) {
                            const qrWrp = document.createElement('div');
                            new window.QRCode(qrWrp, {
                                text: order.id_pesanan, width: 50, height: 50,
                                colorDark: "#000000", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.L
                            });
                            setTimeout(() => {
                                try {
                                    const canvas = qrWrp.querySelector('canvas');
                                    if (canvas) doc.addImage(canvas.toDataURL('image/png'), 'PNG', 6, 19, 14, 14);
                                } catch (e) { }
                                finishPdf();
                            }, 50);
                        } else {
                            finishPdf();
                        }
                    });
                };

                for (const order of drafts) {
                    mnResi++;
                    if (!extractedOrders[order.id_pesanan]) {
                        extractedOrders[order.id_pesanan] = {
                            id: order.id_pesanan,
                            platform: 'MANUAL',
                            sumber: order.sumber,
                            dateAdded: new Date().toISOString(),
                            items: [],
                            shipDate: new Date() // Segera Kirim
                        };
                    }
                    order.list_produk.forEach(item => {
                        mnPcs += item.qty;
                        extractedOrders[order.id_pesanan].items.push({
                            sku: item.sku.toUpperCase(),
                            qty: item.qty,
                            scanned: 0,
                            status: 'READY',
                            defect: 0
                        });
                    });

                    try {
                        const manualBlob = await createManualPdfBlob(order, variants);
                        tempPdfTracking.push({
                            file: manualBlob,
                            pageIndex: 0,
                            resi: order.id_pesanan,
                            platform: 'MANUAL',
                            uniqueFileName: `manual_${order.id_pesanan}_${Date.now()}.pdf`
                        });
                    } catch (err) {
                        console.error('Gagal membuat blob PDF untuk Resi Manual: ', err);
                    }
                }
            }

            // PENTING: Set preview SETELAH extract (sukses atau fail), supaya PASTI muncul
            setPlatformStats({
                shopee: { resi: shResi, pcs: shPcs },
                tiktok: { resi: tkResi, pcs: tkPcs },
                lazada: { resi: lzResi, pcs: lzPcs },
                manual: { resi: mnResi, pcs: mnPcs },
                affiliate_tiktok: { resi: affTkResi, pcs: affTkPcs },
                affiliate: { resi: 0, pcs: 0 }
            });

            // FITUR BARU: Tampilkan preview resi SEBELUM kalkulasi ketersediaan
            try {
                setResiPreviews(extractedOrders);
                setShowResiPreview(true);
            } catch (previewErr) {
                console.error("Error setting preview:", previewErr);
            }

            // Kalkulasi Ketersediaan Berdasarkan Data Stok Detail (Master Produk)
            const stockGlobalMap = {};
            transactions.forEach(t => {
                if (t.type === 'IN' || t.type === 'REVISI_IN') { stockGlobalMap[t.sku] = (stockGlobalMap[t.sku] || 0) + t.qty; }
                if (t.type === 'OUT' || t.type === 'REVISI_OUT') { stockGlobalMap[t.sku] = (stockGlobalMap[t.sku] || 0) - t.qty; }
            });

            const availableStockMap = {};
            (variants || []).forEach(v => {
                availableStockMap[v.sku] = stockGlobalMap[v.sku] !== undefined ? stockGlobalMap[v.sku] : Number(v.stock || v.stok || 0);
            });

            const requiredMap = {};
            const unrecognizedMap = {};
            const readyList = [];
            const poList = [];
            const finalQcOrders = [];

            // FUNGSI SAKTI: Mengabaikan Spasi dan Garis Strip saat mencocokkan SKU dari PDF vs Database
            const normalizeSku = (str) => str ? str.replace(/[\s\-_]+/g, '').toUpperCase() : '';

            const sortedExtractedOrders = Object.values(extractedOrders).sort((a, b) => {
                const dateA = a.shipDate ? new Date(a.shipDate).getTime() : Infinity;
                const dateB = b.shipDate ? new Date(b.shipDate).getTime() : Infinity;
                return dateA - dateB;
            });

            sortedExtractedOrders.forEach(order => {
                let hasPO = false;
                order.items.forEach(item => {
                    // PENCARIAN SKU YANG SUDAH DIPERBAIKI (ANTI-MELESET 100%)
                    const matchedVariant = variants.find(v =>
                        normalizeSku(v.sku) === normalizeSku(item.sku) ||
                        normalizeSku(`${v.article}-${v.colorName}-${v.sizeName}`) === normalizeSku(item.sku)
                    );

                    if (matchedVariant) {
                        const sysSku = matchedVariant.sku;
                        if (!requiredMap[sysSku]) requiredMap[sysSku] = { variant: matchedVariant, required: 0, isUrgent: false };
                        requiredMap[sysSku].required += item.qty;

                        if (order.shipDate) {
                            const todayCheck = new Date();
                            todayCheck.setHours(0, 0, 0, 0);
                            if (order.shipDate <= todayCheck) {
                                requiredMap[sysSku].isUrgent = true;
                            }
                        }

                        if (availableStockMap[sysSku] >= item.qty) {
                            item.status = 'READY';
                            item.prodStatus = 'READY'; // Field khusus Dashboard Produksi
                            availableStockMap[sysSku] -= item.qty;
                        } else {
                            item.status = 'PO';
                            item.prodStatus = 'PO'; // Field khusus Dashboard Produksi
                            hasPO = true;
                            if (availableStockMap[sysSku] > 0) availableStockMap[sysSku] = 0;
                        }
                        item.sysSku = sysSku;
                    } else {
                        item.status = 'UNRECOGNIZED';
                        item.prodStatus = 'UNRECOGNIZED';
                        if (!unrecognizedMap[item.sku]) unrecognizedMap[item.sku] = 0;
                        unrecognizedMap[item.sku] += item.qty;
                    }
                });
                finalQcOrders.push(order);
            });

            // stockGlobalMap sudah dihitung di atas

            Object.keys(requiredMap).forEach(sku => {
                const reqData = requiredMap[sku];
                const available = stockGlobalMap[sku] || 0;
                if (available >= reqData.required) {
                    readyList.push({ variant: reqData.variant, qty: reqData.required });
                } else if (available > 0 && available < reqData.required) {
                    readyList.push({ variant: reqData.variant, qty: available });
                    poList.push({ variant: reqData.variant, missingQty: reqData.required - available, isUrgent: reqData.isUrgent });
                } else {
                    poList.push({ variant: reqData.variant, missingQty: reqData.required, isUrgent: reqData.isUrgent });
                }
            });

            const unrecognizedList = Object.keys(unrecognizedMap).map(sku => ({ sku: sku, qty: unrecognizedMap[sku] }));

            // Helper: tentukan kelompok pabrik berdasarkan artikel
            const parseArticleForSortGlobal = (articleName) => {
                if (!articleName) return { prefix: "", num: 0, group: 0 };
                const parts = articleName.split('-');
                const prefix = parts[0] || "";
                let num = 0, group = 0;
                if (parts.length > 1) {
                    const codePart = parts.slice(1).join('-');
                    const dotParts = codePart.split('.');
                    num = parseInt(dotParts[0], 10) || 0;
                    if (dotParts.length > 1) group = parseInt(dotParts[1], 10) || 0;
                }
                return { prefix, num, group };
            };

            const getFactoryGroup = (article) => {
                const prefix = (article || '').toUpperCase().split('-')[0];
                if (prefix === 'F07' || prefix === 'F04') return 2;
                if (prefix === 'F02') return 1;
                return 0; // Pabrik F01 (Utama)
            };

            // Fungsi Pembanding Absolut: pabrik -> artikel -> warna -> size (100% Cocok dgn LaporanStok)
            const strictFaradelaSort = (skuAStr, skuBStr) => {
                const findVariant = (searchSku) => {
                    if (!searchSku) return null;
                    const normSearch = normalizeSku(searchSku);
                    return variants.find(v =>
                        normalizeSku(v.sku) === normSearch ||
                        normalizeSku(`${v.article}-${v.colorName}-${v.sizeName}`) === normSearch
                    );
                };

                const varA = findVariant(skuAStr);
                const varB = findVariant(skuBStr);

                const extractFallbackArt = (skuStr) => {
                    const match = skuStr.match(/^([A-Z0-9]+(?:[\.\-]\d+(?:\.\d+)*)?)/i);
                    return match ? match[1].toUpperCase() : 'ZZZ';
                };

                const artAStr = varA ? varA.article.toUpperCase() : extractFallbackArt(skuAStr);
                const artBStr = varB ? varB.article.toUpperCase() : extractFallbackArt(skuBStr);

                // 1. Factory Group Prioritas
                const factA = getFactoryGroup(artAStr);
                const factB = getFactoryGroup(artBStr);
                if (factA !== factB) return factA - factB;

                // 2. Artikel Sort (Tiruan mutlak Laporan Stok)
                const infoA = parseArticleForSortGlobal(artAStr);
                const infoB = parseArticleForSortGlobal(artBStr);

                const prefixCmp = infoA.prefix.localeCompare(infoB.prefix, undefined, { numeric: true });
                if (prefixCmp !== 0) return prefixCmp;
                if (infoA.group !== infoB.group) return infoA.group - infoB.group;
                if (infoA.num !== infoB.num) return infoA.num - infoB.num;

                // 3. Warna (Menggunakan Index dari array Master Data Products, Sama dgn Laporan Stok)
                // Karena LaporanStok me-render berurutan berdasarkan array db "colors"
                let colAIdx = varA && varA.colorIndex !== undefined ? varA.colorIndex : 999;
                let colBIdx = varB && varB.colorIndex !== undefined ? varB.colorIndex : 999;

                if (colAIdx !== colBIdx) return colAIdx - colBIdx;

                // 4. Size (Diurutkan secara numerik/angka)
                const sizeA = varA ? varA.sizeName : skuAStr.split('-').pop();
                const sizeB = varB ? varB.sizeName : skuBStr.split('-').pop();
                return sizeA.localeCompare(sizeB, undefined, { numeric: true });
            };

            const sortVariants = (a, b) => {
                return strictFaradelaSort(a.variant.sku, b.variant.sku);
            };

            readyList.sort(sortVariants);

            const groupedPoMap = {};
            poList.forEach(item => {
                const key = item.variant.sku;
                if (!groupedPoMap[key]) {
                    groupedPoMap[key] = { ...item };
                } else {
                    groupedPoMap[key].missingQty += item.missingQty;
                    if (item.isUrgent) groupedPoMap[key].isUrgent = true;
                }
            });
            const collapsedPoList = Object.values(groupedPoMap);
            collapsedPoList.sort(sortVariants);

            unrecognizedList.sort((a, b) => a.sku.localeCompare(b.sku));

            // Tentukan primary SKU per resi berdasarkan urutan Master yang mutlak
            tempPdfTracking.forEach(track => {
                const order = extractedOrders[track.resi];
                if (order && order.items.length > 0) {
                    const sortedSkus = [...order.items].sort((a, b) => strictFaradelaSort(a.sku, b.sku));
                    track.primarySku = sortedSkus[0].sku;
                } else {
                    track.primarySku = 'ZZZ';
                }
            });

            // Sort halaman PDF: Pabrik -> Artikel -> Warna -> Size !
            tempPdfTracking.sort((a, b) => {
                return strictFaradelaSort(a.primarySku, b.primarySku);
            });

            setPdfTrackingData(tempPdfTracking);

            setAnalysisResult({
                summary: { totalResi: shResi + tkResi + lzResi + mnResi, totalPcsShopee: shPcs + tkPcs + lzPcs + mnPcs },
                readyList, poList: collapsedPoList, unrecognizedList,
                qcOrdersQueue: finalQcOrders
            });

            setAnalysisTime(new Date());
            setActiveTab('PO');
            showToast('success', 'Sukses Menganalisis Semua Pesanan!');
        } catch (err) {
            console.error("Error di processAllPlatforms:", err);
            showToast('error', 'Gagal memproses file: ' + err.message);
        } finally { setIsLoadingLocal(false); }
    };

    // FUNGSI REKAP: Proses analisis dengan data resi yang sudah diedit
    const handleRekapSekarang = async () => {
        if (!resiPreviews || Object.keys(resiPreviews).length === 0) {
            return showToast('error', 'Tidak ada resi untuk direkap.');
        }

        setIsLoadingLocal(true);
        try {
            // Rebuild extractedOrders dengan data yang sudah diedit
            const updatedExtractedOrders = {};

            Object.values(resiPreviews).forEach((order, orderIdx) => {
                const resiId = order.id;
                updatedExtractedOrders[resiId] = {
                    id: resiId,
                    platform: order.platform,
                    dateAdded: order.dateAdded,
                    items: order.items.map((item, itemIdx) => {
                        const editKey = `${resiId}-${itemIdx}`;
                        const editedData = editedResiItems[editKey];

                        if (editedData) {
                            return {
                                ...item,
                                sku: editedData.sku || item.sku,
                                isEdited: true // Mark item yang diedit
                            };
                        }
                        return item;
                    }),
                    shipDate: editedResiItems[`${resiId}-shipDate`] || order.shipDate
                };
            });

            // Kalkulasi ulang Ketersediaan
            const stockGlobalMap = {};
            transactions.forEach(t => {
                if (t.type === 'IN' || t.type === 'REVISI_IN') { stockGlobalMap[t.sku] = (stockGlobalMap[t.sku] || 0) + t.qty; }
                if (t.type === 'OUT' || t.type === 'REVISI_OUT') { stockGlobalMap[t.sku] = (stockGlobalMap[t.sku] || 0) - t.qty; }
            });

            const availableStockMap = {};
            (variants || []).forEach(v => {
                availableStockMap[v.sku] = stockGlobalMap[v.sku] !== undefined ? stockGlobalMap[v.sku] : Number(v.stock || v.stok || 0);
            });

            const requiredMap = {};
            const unrecognizedMap = {};
            const readyList = [];
            const poList = [];
            const finalQcOrders = [];

            const normalizeSku = (str) => str ? str.replace(/[\s\-_]+/g, '').toUpperCase() : '';

            // FIX: Gunakan string 'YYYY-MM-DD' untuk perbandingan agar shipDate yang diedit (string) terdeteksi benar
            const todayCompareStr = new Date().toISOString().split('T')[0];

            const sortedUpdatedOrders = Object.values(updatedExtractedOrders).sort((a, b) => {
                const dateA = a.shipDate ? new Date(a.shipDate).getTime() : Infinity;
                const dateB = b.shipDate ? new Date(b.shipDate).getTime() : Infinity;
                return dateA - dateB;
            });

            sortedUpdatedOrders.forEach(order => {
                let hasPO = false;
                order.items.forEach(item => {
                    const matchedVariant = variants.find(v =>
                        normalizeSku(v.sku) === normalizeSku(item.sku) ||
                        normalizeSku(`${v.article}-${v.colorName}-${v.sizeName}`) === normalizeSku(item.sku)
                    );

                    if (matchedVariant) {
                        const sysSku = matchedVariant.sku;
                        if (!requiredMap[sysSku]) requiredMap[sysSku] = { variant: matchedVariant, required: 0, isUrgent: false, isEdited: item.isEdited };
                        requiredMap[sysSku].required += item.qty;
                        if (item.isEdited) requiredMap[sysSku].isEdited = true;

                        // FIX: Normalisasi shipDate ke string 'YYYY-MM-DD' agar perbandingan konsisten
                        if (order.shipDate) {
                            let shipDateStr;
                            if (typeof order.shipDate === 'string') {
                                shipDateStr = order.shipDate; // Sudah 'YYYY-MM-DD'
                            } else {
                                shipDateStr = new Date(order.shipDate).toISOString().split('T')[0];
                            }
                            if (shipDateStr <= todayCompareStr) {
                                requiredMap[sysSku].isUrgent = true;
                            }
                        }

                        if (availableStockMap[sysSku] >= item.qty) {
                            item.status = 'READY';
                            item.prodStatus = 'READY';
                            availableStockMap[sysSku] -= item.qty;
                        } else {
                            item.status = 'PO';
                            item.prodStatus = 'PO';
                            hasPO = true;
                            if (availableStockMap[sysSku] > 0) availableStockMap[sysSku] = 0;
                        }
                        item.sysSku = sysSku;
                    } else {
                        item.status = 'UNRECOGNIZED';
                        item.prodStatus = 'UNRECOGNIZED';
                        if (!unrecognizedMap[item.sku]) unrecognizedMap[item.sku] = 0;
                        unrecognizedMap[item.sku] += item.qty;
                    }
                });
                finalQcOrders.push(order);
            });

            // stockGlobalMap sudah dihitung di atas

            Object.keys(requiredMap).forEach(sku => {
                const reqData = requiredMap[sku];
                const available = stockGlobalMap[sku] || 0;
                if (available >= reqData.required) {
                    readyList.push({ variant: reqData.variant, qty: reqData.required, isEdited: reqData.isEdited });
                } else if (available > 0 && available < reqData.required) {
                    readyList.push({ variant: reqData.variant, qty: available, isEdited: reqData.isEdited });
                    poList.push({ variant: reqData.variant, missingQty: reqData.required - available, isUrgent: reqData.isUrgent, isEdited: reqData.isEdited });
                } else {
                    poList.push({ variant: reqData.variant, missingQty: reqData.required, isUrgent: reqData.isUrgent, isEdited: reqData.isEdited });
                }
            });

            const unrecognizedList = Object.keys(unrecognizedMap).map(sku => ({ sku: sku, qty: unrecognizedMap[sku] }));

            // Sort sama seperti di processAllPlatforms
            const parseArticleForSort = (articleName) => {
                if (!articleName) return { prefix: "", num: 0, group: 0 };
                const parts = articleName.split('-');
                const prefix = parts[0] || "";
                let num = 0, group = 0;
                if (parts.length > 1) {
                    const codePart = parts.slice(1).join('-');
                    const dotParts = codePart.split('.');
                    num = parseInt(dotParts[0], 10) || 0;
                    if (dotParts.length > 1) group = parseInt(dotParts[1], 10) || 0;
                }
                return { prefix, num, group };
            };

            const getFactoryGroup = (article) => {
                const prefix = (article || '').toUpperCase().split('-')[0];
                if (prefix === 'F07' || prefix === 'F04') return 2;
                if (prefix === 'F02') return 1;
                return 0;
            };

            const strictFaradelaSort = (skuAStr, skuBStr) => {
                const findVariant = (searchSku) => {
                    if (!searchSku) return null;
                    const normSearch = normalizeSku(searchSku);
                    return variants.find(v =>
                        normalizeSku(v.sku) === normSearch ||
                        normalizeSku(`${v.article}-${v.colorName}-${v.sizeName}`) === normSearch
                    );
                };

                const varA = findVariant(skuAStr);
                const varB = findVariant(skuBStr);

                const extractFallbackArt = (skuStr) => {
                    const match = skuStr.match(/^([A-Z0-9]+(?:[\.\-]\d+(?:\.\d+)*)?)/i);
                    return match ? match[1].toUpperCase() : 'ZZZ';
                };

                const artAStr = varA ? varA.article.toUpperCase() : extractFallbackArt(skuAStr);
                const artBStr = varB ? varB.article.toUpperCase() : extractFallbackArt(skuBStr);

                const factA = getFactoryGroup(artAStr);
                const factB = getFactoryGroup(artBStr);
                if (factA !== factB) return factA - factB;

                const infoA = parseArticleForSort(artAStr);
                const infoB = parseArticleForSort(artBStr);

                const prefixCmp = infoA.prefix.localeCompare(infoB.prefix, undefined, { numeric: true });
                if (prefixCmp !== 0) return prefixCmp;
                if (infoA.group !== infoB.group) return infoA.group - infoB.group;
                if (infoA.num !== infoB.num) return infoA.num - infoB.num;

                let colAIdx = varA && varA.colorIndex !== undefined ? varA.colorIndex : 999;
                let colBIdx = varB && varB.colorIndex !== undefined ? varB.colorIndex : 999;
                if (colAIdx !== colBIdx) return colAIdx - colBIdx;

                const sizeA = varA ? varA.sizeName : skuAStr.split('-').pop();
                const sizeB = varB ? varB.sizeName : skuBStr.split('-').pop();
                return sizeA.localeCompare(sizeB, undefined, { numeric: true });
            };

            const sortVariants = (a, b) => {
                return strictFaradelaSort(a.variant.sku, b.variant.sku);
            };

            readyList.sort(sortVariants);

            const groupedPoMap = {};
            poList.forEach(item => {
                const key = item.variant.sku;
                if (!groupedPoMap[key]) {
                    groupedPoMap[key] = { ...item };
                } else {
                    groupedPoMap[key].missingQty += item.missingQty;
                    if (item.isUrgent) groupedPoMap[key].isUrgent = true;
                    if (item.isEdited) groupedPoMap[key].isEdited = true;
                }
            });
            const collapsedPoList = Object.values(groupedPoMap);
            collapsedPoList.sort(sortVariants);

            unrecognizedList.sort((a, b) => a.sku.localeCompare(b.sku));

            // Set hasil analisis dengan flag isEdited
            setAnalysisResult({
                summary: { totalResi: Object.keys(updatedExtractedOrders).length, totalPcsShopee: Object.values(updatedExtractedOrders).reduce((a, o) => a + o.items.reduce((b, i) => b + i.qty, 0), 0) },
                readyList, poList: collapsedPoList, unrecognizedList,
                qcOrdersQueue: finalQcOrders
            });

            // Simpan edited items tracking untuk marking saat print
            setEditedItemsTracking(editedResiItems);

            setAnalysisTime(new Date());
            setActiveTab('PO');
            // JANGAN tutup modal preview, biar bisa edit lagi
            showToast('success', 'Analisis ulang berdasarkan data yang diedit!');
        } catch (err) {
            console.error("Error di handleRekapSekarang:", err);
            showToast('error', 'Gagal melakukan rekap ulang: ' + err.message);
        } finally {
            setIsLoadingLocal(false);
        }
    };

    // FUNGSI EDIT: Handle perubahan data resi
    const handleEditResiItem = (resiId, itemIdx, field, value) => {
        const editKey = (field === 'shipDate' || field === 'catatan') ? `${resiId}-${field}` : `${resiId}-${itemIdx}`;
        const currentEdit = editedResiItems[editKey] || {};

        if (field === 'shipDate' || field === 'catatan') {
            setEditedResiItems(prev => ({
                ...prev,
                [editKey]: value
            }));
        } else {
            setEditedResiItems(prev => ({
                ...prev,
                [editKey]: {
                    ...currentEdit,
                    [field]: value
                }
            }));
        }

        setHasEdits(true);
    };

    // -----------------------------------------------------------------------------------------------------
    // FUNGSI BARU: Cetak Daftar Resi Berurutan (Membaca file asli dan menggabungkan halamannya via pdf-lib)
    // -----------------------------------------------------------------------------------------------------
    const generateSortedPDF = async () => {
        if (!pdfTrackingData || pdfTrackingData.length === 0) {
            return showToast('error', 'Tidak ada data resi untuk dicetak.');
        }

        setIsGeneratingPdf(true);
        showToast('info', 'Sedang menyusun PDF berurutan, mohon tunggu...', 3000);

        try {
            const { PDFDocument } = PDFLib;
            const mergedPdf = await PDFDocument.create();

            // Embed font sekali untuk semua annotation
            let annotateFont = null;
            let annotateBoldFont = null;
            try {
                annotateFont = await mergedPdf.embedFont(PDFLib.StandardFonts.Helvetica);
                annotateBoldFont = await mergedPdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
            } catch (e) { }

            // Cache file yang sudah di-load agar tidak membaca arrayBuffer berulang kali untuk file yg sama
            const loadedFilesCache = new Map();

            for (const track of pdfTrackingData) {
                try {
                    const fileName = track.uniqueFileName || track.file.name;
                    let srcDoc;

                    if (loadedFilesCache.has(fileName)) {
                        srcDoc = loadedFilesCache.get(fileName);
                    } else {
                        const arrayBuffer = track.arrayBuffer ? track.arrayBuffer : await track.file.arrayBuffer();
                        srcDoc = await PDFDocument.load(arrayBuffer);
                        loadedFilesCache.set(fileName, srcDoc);
                    }

                    // Copy halaman spesifik dari dokumen sumber
                    const [copiedPage] = await mergedPdf.copyPages(srcDoc, [track.pageIndex]);
                    mergedPdf.addPage(copiedPage);

                    // ====== TANDA EDIT: Tambahkan anotasi jika resi ini diedit ======
                    try {
                        if (annotateFont) {
                            const resiId = track.resi;
                            const editLines = [];
                            for (let idx = 0; idx <= 4; idx++) {
                                const itemEdit = editedResiItems[`${resiId}-${idx}`];
                                if (itemEdit && itemEdit.sku) {
                                    editLines.push('SKU diubah: ' + itemEdit.sku);
                                }
                            }
                            const dateEdit = editedResiItems[`${resiId}-shipDate`];
                            if (dateEdit) editLines.push('Batas Kirim diubah: ' + dateEdit);

                            const catatanText = editedResiItems[`${resiId}-catatan`];
                            if (editLines.length > 0 || catatanText) {
                                const pg = mergedPdf.getPage(mergedPdf.getPageCount() - 1);
                                const { width, height } = pg.getSize();

                                const padX = 6; const padY = 6;
                                const headerFontSize = 7; const gap = 4;

                                let needsLeftPanel = editLines.length > 0;
                                let needsRightPanel = !!catatanText;

                                let leftPanelW = needsRightPanel ? ((width / 2) - padX * 2) : (width - padX * 2);

                                // Auto scale left panel font
                                let fontSize = 9;
                                if (needsLeftPanel) {
                                    let maxW = leftPanelW - 4; // Subtract left text extra indent
                                    while (fontSize > 5) {
                                        let fits = true;
                                        for (let i = 0; i < editLines.length; i++) {
                                            const w = annotateBoldFont ? annotateBoldFont.widthOfTextAtSize('-> ' + editLines[i], fontSize) : (fontSize * editLines[i].length * 0.6);
                                            if (w > maxW) { fits = false; break; }
                                        }
                                        if (fits) break;
                                        fontSize--;
                                    }
                                }
                                const lineH = fontSize + 4;

                                const minLeftH = padY * 2 + headerFontSize + gap + Math.max(0, editLines.length) * lineH;

                                let rightPanelW = needsLeftPanel ? ((width / 2) - padX * 2) : (width - padX * 2);
                                let cFont = 14; let cLines = [];

                                if (needsRightPanel) {
                                    while (cFont > 6) {
                                        cLines = [];
                                        const words = catatanText.split(' ');
                                        let currentLine = words[0];
                                        for (let i = 1; i < words.length; i++) {
                                            const word = words[i];
                                            const w = annotateBoldFont ? annotateBoldFont.widthOfTextAtSize(currentLine + " " + word, cFont) : 0;
                                            if (w < rightPanelW) {
                                                currentLine += " " + word;
                                            } else {
                                                cLines.push(currentLine);
                                                currentLine = word;
                                            }
                                        }
                                        cLines.push(currentLine);
                                        let totalCHeight = padY * 2 + headerFontSize + gap + cLines.length * (cFont * 1.2);
                                        if (totalCHeight <= 100 || cFont === 6) break;
                                        cFont--;
                                    }
                                }

                                let rightH = needsRightPanel ? (padY * 2 + headerFontSize + gap + cLines.length * (cFont * 1.2)) : 0;
                                let boxH = Math.max(needsLeftPanel ? minLeftH : 0, rightH);
                                if (boxH < 30) boxH = 30;

                                pg.drawRectangle({
                                    x: 0, y: 0, width: width, height: boxH,
                                    borderColor: PDFLib.rgb(0, 0, 0),
                                    borderWidth: 1.5
                                });

                                if (needsLeftPanel && needsRightPanel) {
                                    pg.drawLine({
                                        start: { x: width / 2, y: 0 },
                                        end: { x: width / 2, y: boxH },
                                        color: PDFLib.rgb(0, 0, 0),
                                        thickness: 1.5
                                    });
                                }

                                if (needsLeftPanel) {
                                    let currentY = boxH - padY - headerFontSize;
                                    pg.drawText('ITEM DIEDIT OLEH TIM:', {
                                        x: padX, y: currentY,
                                        size: headerFontSize, font: annotateFont,
                                        color: PDFLib.rgb(0, 0, 0)
                                    });
                                    currentY -= gap;
                                    editLines.forEach(function (line) {
                                        currentY -= fontSize;
                                        pg.drawText('-> ' + line, {
                                            x: padX + 4, y: currentY,
                                            size: fontSize, font: annotateBoldFont || annotateFont,
                                            color: PDFLib.rgb(0, 0, 0)
                                        });
                                        currentY -= (lineH - fontSize);
                                    });
                                }

                                if (needsRightPanel) {
                                    const rightX = needsLeftPanel ? (width / 2 + padX) : padX;
                                    let currentY = boxH - padY - headerFontSize;
                                    pg.drawText('CATATAN:', {
                                        x: rightX, y: currentY,
                                        size: headerFontSize, font: annotateFont,
                                        color: PDFLib.rgb(0, 0, 0)
                                    });
                                    currentY -= gap;
                                    cLines.forEach(line => {
                                        currentY -= cFont;
                                        pg.drawText(line, {
                                            x: rightX, y: currentY, size: cFont, font: annotateBoldFont || annotateFont, color: PDFLib.rgb(0, 0, 0)
                                        });
                                        currentY -= (cFont * 0.2);
                                    });
                                }
                            }
                        }
                    } catch (annotErr) { console.warn('Annotation error:', annotErr); }
                    // ================================================================
                } catch (pageErr) {
                    console.error(`Gagal memproses resi ${track.resi} halaman ${track.pageIndex}:`, pageErr);
                }
            }

            const pdfBytes = await mergedPdf.save();

            // Buat blob dan trigger download
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `Resi_Berurutan_${dateStr}.pdf`;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            showToast('success', 'PDF Resi Berurutan berhasil diunduh!');
        } catch (error) {
            console.error("Error generating sorted PDF:", error);
            showToast('error', 'Terjadi kesalahan saat membuat PDF.');
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    // FUNGSI BARU: Cetak Resi Shipping Khusus yang READY (Langsung dari GRPA)
    const handlePrintCurrentResi = async (filterType = 'ready') => {
        if (!pdfTrackingData || pdfTrackingData.length === 0) {
            return showToast('error', 'Tidak ada data resi untuk dicetak.');
        }
        if (!analysisResult || !analysisResult.qcOrdersQueue) {
            return showToast('error', 'Silakan klik Gabungkan & Analisis terlebih dahulu.');
        }

        // Filter resi berdasarkan status Ready
        const filteredTracking = pdfTrackingData.filter(track => {
            const order = analysisResult.qcOrdersQueue.find(o =>
                o.id === track.resi ||
                o.awb === track.resi ||
                (o.items && o.items[0] && o.items[0].originalOrderId === track.resi)
            );

            if (!order) return false;

            const isPO = (order.items || []).some(it => it.status === 'PO' || it.status === 'UNRECOGNIZED');
            const isReady = !isPO;

            if (filterType === 'ready') return isReady;
            if (filterType === 'po') return isPO;
            return true;
        });

        if (filteredTracking.length === 0) {
            return showToast('error', `Tidak ada resi dalam kategori ${filterType.toUpperCase()} untuk dicetak.`);
        }

        setIsGeneratingPdf(true);
        showToast('info', `Sedang menyusun PDF Resi Shipping ${filterType.toUpperCase()}...`, 3000);

        try {
            const { PDFDocument } = PDFLib;
            const mergedPdf = await PDFDocument.create();

            // Embed font sekali untuk semua annotation
            let annotateFont2 = null;
            let annotateBoldFont2 = null;
            try {
                annotateFont2 = await mergedPdf.embedFont(PDFLib.StandardFonts.Helvetica);
                annotateBoldFont2 = await mergedPdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
            } catch (e) { }

            const loadedFilesCache = new Map();

            for (const track of filteredTracking) {
                try {
                    const fileName = track.uniqueFileName || track.file.name;
                    let srcDoc;

                    if (loadedFilesCache.has(fileName)) {
                        srcDoc = loadedFilesCache.get(fileName);
                    } else {
                        const arrayBuffer = track.arrayBuffer ? track.arrayBuffer : await track.file.arrayBuffer();
                        srcDoc = await PDFDocument.load(arrayBuffer);
                        loadedFilesCache.set(fileName, srcDoc);
                    }

                    const [copiedPage] = await mergedPdf.copyPages(srcDoc, [track.pageIndex]);
                    mergedPdf.addPage(copiedPage);

                    // ====== TANDA EDIT: Tambahkan anotasi jika resi ini diedit ======
                    try {
                        if (annotateFont2) {
                            const resiId = track.resi;
                            const editLines2 = [];
                            for (let idx = 0; idx <= 4; idx++) {
                                const itemEdit = editedResiItems[`${resiId}-${idx}`];
                                if (itemEdit && itemEdit.sku) editLines2.push('SKU diubah: ' + itemEdit.sku);
                            }
                            const dateEdit2 = editedResiItems[`${resiId}-shipDate`];
                            if (dateEdit2) editLines2.push('Batas Kirim diubah: ' + dateEdit2);

                            const catatanText2 = editedResiItems[`${resiId}-catatan`];
                            if (editLines2.length > 0 || catatanText2) {
                                const pg2 = mergedPdf.getPage(mergedPdf.getPageCount() - 1);
                                const { width: w2 } = pg2.getSize();

                                const padX2 = 6; const padY2 = 6;
                                const headerFontSize2 = 7; const gap2 = 4;

                                let needsLeftPanel2 = editLines2.length > 0;
                                let needsRightPanel2 = !!catatanText2;

                                let leftPanelW2 = needsRightPanel2 ? ((w2 / 2) - padX2 * 2) : (w2 - padX2 * 2);

                                // Auto scale left panel font
                                let fontSize2 = 9;
                                if (needsLeftPanel2) {
                                    let maxW2 = leftPanelW2 - 4;
                                    while (fontSize2 > 5) {
                                        let fits2 = true;
                                        for (let i = 0; i < editLines2.length; i++) {
                                            const w = annotateBoldFont2 ? annotateBoldFont2.widthOfTextAtSize('-> ' + editLines2[i], fontSize2) : (fontSize2 * editLines2[i].length * 0.6);
                                            if (w > maxW2) { fits2 = false; break; }
                                        }
                                        if (fits2) break;
                                        fontSize2--;
                                    }
                                }
                                const lineH2 = fontSize2 + 4;

                                const minLeftH2 = padY2 * 2 + headerFontSize2 + gap2 + Math.max(0, editLines2.length) * lineH2;

                                let rightPanelW2 = needsLeftPanel2 ? ((w2 / 2) - padX2 * 2) : (w2 - padX2 * 2);
                                let cFont2 = 14; let cLines2 = [];

                                if (needsRightPanel2) {
                                    while (cFont2 > 6) {
                                        cLines2 = [];
                                        const words = catatanText2.split(' ');
                                        let currentLine = words[0];
                                        for (let i = 1; i < words.length; i++) {
                                            const word = words[i];
                                            const w = annotateBoldFont2 ? annotateBoldFont2.widthOfTextAtSize(currentLine + " " + word, cFont2) : 0;
                                            if (w < rightPanelW2) {
                                                currentLine += " " + word;
                                            } else {
                                                cLines2.push(currentLine);
                                                currentLine = word;
                                            }
                                        }
                                        cLines2.push(currentLine);
                                        let totalCHeight = padY2 * 2 + headerFontSize2 + gap2 + cLines2.length * (cFont2 * 1.2);
                                        if (totalCHeight <= 100 || cFont2 === 6) break;
                                        cFont2--;
                                    }
                                }

                                let rightH2 = needsRightPanel2 ? (padY2 * 2 + headerFontSize2 + gap2 + cLines2.length * (cFont2 * 1.2)) : 0;
                                let boxH2 = Math.max(needsLeftPanel2 ? minLeftH2 : 0, rightH2);
                                if (boxH2 < 30) boxH2 = 30;

                                pg2.drawRectangle({
                                    x: 0, y: 0, width: w2, height: boxH2,
                                    borderColor: PDFLib.rgb(0, 0, 0),
                                    borderWidth: 1.5
                                });

                                if (needsLeftPanel2 && needsRightPanel2) {
                                    pg2.drawLine({
                                        start: { x: w2 / 2, y: 0 },
                                        end: { x: w2 / 2, y: boxH2 },
                                        color: PDFLib.rgb(0, 0, 0),
                                        thickness: 1.5
                                    });
                                }

                                if (needsLeftPanel2) {
                                    let currentY = boxH2 - padY2 - headerFontSize2;
                                    pg2.drawText('ITEM DIEDIT OLEH TIM:', {
                                        x: padX2, y: currentY,
                                        size: headerFontSize2, font: annotateFont2,
                                        color: PDFLib.rgb(0, 0, 0)
                                    });
                                    currentY -= gap2;
                                    editLines2.forEach(function (line) {
                                        currentY -= fontSize2;
                                        pg2.drawText('-> ' + line, {
                                            x: padX2 + 4, y: currentY,
                                            size: fontSize2, font: annotateBoldFont2 || annotateFont2,
                                            color: PDFLib.rgb(0, 0, 0)
                                        });
                                        currentY -= (lineH2 - fontSize2);
                                    });
                                }

                                if (needsRightPanel2) {
                                    const rightX = needsLeftPanel2 ? (w2 / 2 + padX2) : padX2;
                                    let currentY = boxH2 - padY2 - headerFontSize2;
                                    pg2.drawText('CATATAN:', {
                                        x: rightX, y: currentY,
                                        size: headerFontSize2, font: annotateFont2,
                                        color: PDFLib.rgb(0, 0, 0)
                                    });
                                    currentY -= gap2;
                                    cLines2.forEach(line => {
                                        currentY -= cFont2;
                                        pg2.drawText(line, {
                                            x: rightX, y: currentY, size: cFont2, font: annotateBoldFont2 || annotateFont2, color: PDFLib.rgb(0, 0, 0)
                                        });
                                        currentY -= (cFont2 * 0.2);
                                        });
                                    }
                                }
                            }
                        } catch (annotErr) { console.warn('Annotation error:', annotErr); }
                } catch (pageErr) {
                    console.error(`Gagal memproses resi ${track.resi}:`, pageErr);
                }
            }

            const pdfBytes = await mergedPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            // Buka di tab baru (User bisa print dari sana) atau download
            const win = window.open(url, '_blank');
            if (!win) {
                // Fallback download if popup blocked
                const a = document.createElement('a');
                a.href = url;
                a.download = `Resi_Shipping_${filterType.toUpperCase()}_${Date.now()}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }

            showToast('success', `Berhasil menyiapkan ${filteredTracking.length} Resi Shipping!`);
        } catch (error) {
            console.error("Error generating shipping labels:", error);
            showToast('error', 'Gagal memproses PDF Resi.');
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const handleHapusAntrianReady = async () => {
        const confirmed = window.confirm("Hapus semua antrean Resi Ready? (Resi tidak akan terhapus, hanya dikeluarkan dari antrean)");
        if (!confirmed) return;

        setPoDraftLoading(true);
        try {
            const batchDel = db.batch();
            readyDrafts.forEach(d => batchDel.delete(db.collection('ready_drafts').doc(d.id)));
            await batchDel.commit();

            await loadReadyDrafts();
            showToast('success', 'Antrean Ready berhasil dihapus!');
        } catch (e) {
            showToast('error', 'Gagal menghapus antrean Ready.');
            console.error(e);
        }
        setPoDraftLoading(false);
    };

    const handleCetakResiReadyAntrian = async () => {
        if (readyDrafts.length === 0) return showToast('error', 'Antrean Ready kosong.');

        // Gabungkan semua tracking info dari readyDrafts
        let mergedPdfTrackingInfo = [];
        readyDrafts.forEach(d => {
            if (d.pdfTrackingInfo) {
                mergedPdfTrackingInfo = [...mergedPdfTrackingInfo, ...d.pdfTrackingInfo];
            }
        });

        if (mergedPdfTrackingInfo.length === 0 && (!draftPdfTrackingData || draftPdfTrackingData.length === 0)) {
            return showToast('error', 'Tidak ada data resi PDF.');
        }

        const draftResiIds = readyDrafts.flatMap(d => d.items.map(it => it.resiId));
        
        let filteredTracking = [];
        let isUsingCloud = false;

        if (draftPdfTrackingData && draftPdfTrackingData.length > 0) {
            filteredTracking = draftPdfTrackingData.filter(track => draftResiIds.includes(track.resi));
        } else {
            filteredTracking = mergedPdfTrackingInfo.filter(track => draftResiIds.includes(track.resi));
            isUsingCloud = true;
        }

        if (filteredTracking.length === 0) {
            return showToast('error', `Tidak ada PDF yang cocok untuk batch antrean ini.`);
        }

        setIsGeneratingPdf(true);
        showToast('info', isUsingCloud ? `Mengunduh & Menyusun PDF dari Cloud...` : `Menyusun PDF Resi Ready untuk Antrean...`, 3000);

        try {
            const { PDFDocument } = window.PDFLib;
            const mergedPdf = await PDFDocument.create();

            if (isUsingCloud) {
                const uniqueUrlsMap = new Map();
                filteredTracking.forEach(track => {
                    if (track.url && track.fileName && !uniqueUrlsMap.has(track.fileName)) {
                        uniqueUrlsMap.set(track.fileName, track.url);
                    }
                });

                const downloadedFiles = {};
                for (const [fName, url] of uniqueUrlsMap.entries()) {
                    try {
                        const response = await fetch(url);
                        downloadedFiles[fName] = await response.arrayBuffer();
                    } catch (e) {
                        console.error('Gagal download PDF', e);
                    }
                }

                const loadedFilesCache = new Map();
                for (const track of filteredTracking) {
                    try {
                        const fName = track.fileName;
                        let srcDoc;
                        if (loadedFilesCache.has(fName)) {
                            srcDoc = loadedFilesCache.get(fName);
                        } else {
                            const arrayBuffer = downloadedFiles[fName];
                            if (arrayBuffer) {
                                srcDoc = await PDFDocument.load(arrayBuffer);
                                loadedFilesCache.set(fName, srcDoc);
                            }
                        }

                        if (srcDoc) {
                            const [copiedPage] = await mergedPdf.copyPages(srcDoc, [track.pageIndex]);
                            mergedPdf.addPage(copiedPage);
                        }
                    } catch (pageErr) {
                        console.error(`Gagal memproses resi ${track.resi}:`, pageErr);
                    }
                }
            } else {
                const loadedFilesCache = new Map();
                for (const track of filteredTracking) {
                    try {
                        const fName = track.uniqueFileName || (track.file ? track.file.name : track.fileName || 'temp.pdf');
                        let srcDoc;
                        
                        if (loadedFilesCache.has(fName)) {
                            srcDoc = loadedFilesCache.get(fName);
                        } else {
                            let arrayBuffer = track.arrayBuffer || (track.file ? await track.file.arrayBuffer() : null);
                            
                            if (!arrayBuffer && track.url) {
                                const resp = await fetch(track.url);
                                arrayBuffer = await resp.arrayBuffer();
                            }
                            
                            if (arrayBuffer) {
                                srcDoc = await PDFDocument.load(arrayBuffer);
                                loadedFilesCache.set(fName, srcDoc);
                            }
                        }

                        if (srcDoc) {
                            const [copiedPage] = await mergedPdf.copyPages(srcDoc, [track.pageIndex]);
                            mergedPdf.addPage(copiedPage);
                        }
                    } catch (pageErr) {
                        console.error(`Gagal memproses resi ${track.resi}:`, pageErr);
                    }
                }
            }

            const pdfBytes = await mergedPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const win = window.open(url, '_blank');
            if (!win) {
                const a = document.createElement('a');
                a.href = url;
                a.download = `Resi_Shipping_READY_ANTREAN_${Date.now()}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }

            // Tandai sudah dicetak agar tidak double print di Riwayat
            // Ini opsional, karena kita nanti mem-filter berdasarkan batchTimestamp terakhir
            showToast('success', `Berhasil menyiapkan ${filteredTracking.length} Resi Ready!`);
        } catch (error) {
            console.error("Error generating ready labels:", error);
            showToast('error', 'Gagal memproses PDF Resi.');
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    // Cetak label dari SEMUA item antrian PO
    const handleCetakLabelAntrian = () => {
        if (poDrafts.length === 0) return showToast('error', 'Antrian PO kosong. Belum ada yang disimpan.');
        const printWindow = window.open('', '_blank');
        if (!printWindow) return showToast('error', 'Gagal membuka tab baru. Izinkan Pop-up Blocker!');

        // --- PROSES DATA ---
        let printList = [];
        poDrafts.forEach(draft => {
            const printDate = draft.targetDate || draft.savedAt.split('T')[0];
            const sessionCodeInt = draft.session || 1;

            draft.items.forEach(item => {
                // Karena draft item tidak simpan sku lengkap, sellPrice & photo, kita harus mencarinya dari Master Variant
                const matchedVariant = variants.find(v => v.sku === (item.sku || item.sysSku)) || 
                                       variants.find(v => String(v.article).trim().toUpperCase() === String(item.article).trim().toUpperCase() && 
                                                          String(v.colorName).trim().toUpperCase() === String(item.colorName).trim().toUpperCase() && 
                                                          String(v.sizeName).trim().toUpperCase() === String(item.sizeName).trim().toUpperCase());

                for (let i = 0; i < item.missingQty; i++) {
                    printList.push({
                        article: item.article,
                        colorName: item.colorName,
                        sizeName: item.sizeName,
                        printDate: printDate,
                        sessionCodeInt: sessionCodeInt,
                        // Tambahan Data master (Fallback bila tidak nemu)
                        sku: matchedVariant ? matchedVariant.sku : `${item.article}-${item.colorName}-${item.sizeName}`,
                        photo: matchedVariant ? matchedVariant.photo : '',
                        sellPrice: matchedVariant ? matchedVariant.sellPrice : 0,
                        isF07Mode: item.article.toUpperCase().startsWith('F07-')
                    });
                }
            });
        });

        // --- HTML STRIKER CETAK ---
        let htmlContent = `
              <!DOCTYPE html>
              <html>
              <head>
                <title>Label PO Antrian</title>
                <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
                <style>
                  @page { margin: 0; }
                  body { margin: 0; padding: 0; font-family: sans-serif; background-color: white; }
                  .label-container { width: 471px; height: 215px; margin: 5px; padding: 0; border: none; box-sizing: border-box; page-break-after: always; page-break-inside: avoid; overflow: hidden; background-color: white; display: flex; justify-content: center; align-items: center; }
                  .label-grid { width: 100%; height: 100%; border: 2px solid black; display: grid; grid-template-columns: 1.4fr 2.4fr 0.9fr; grid-template-rows: 1fr 1fr; box-sizing: border-box; }
                  .cell { display: flex; justify-content: center; align-items: center; padding: 5px; box-sizing: border-box; text-align: center; overflow: hidden; }
                  .br { border-right: 1px solid black; }
                  .bb { border-bottom: 1px solid black; }
                  .photo { max-width: 100%; max-height: 100%; object-fit: contain; }
                  .barcode-svg { max-width: 100%; max-height: 100%; }
                  .size-text { font-size: 50px; font-weight: 900; line-height: 1; margin-bottom: 2px; }
                  .color-text { font-size: 16px; font-weight: bold; text-transform: uppercase; margin-top: 2px; }
                  .prod-container { display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; }
                  .prod-code { font-size: 34px; font-weight: 900; letter-spacing: 1px; }
                  .prod-session { font-size: 30px; font-weight: 900; letter-spacing: 1px; }
                  .article-text { font-size: 20px; font-weight: 900; }
                  .price-text { font-size: 14px; font-weight: bold; margin-top: 4px; }
                </style>
              </head>
              <body>
            `;

        const getProductionCode = (dateString) => {
            if (!dateString) return "";
            const parts = dateString.split('T')[0].split('-');
            if (parts.length !== 3) return "";
            const mapChar = (char) => ({ '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', '6': 'F', '7': 'G', '8': 'H', '9': 'I', '0': 'J' }[char] || char);
            return `${parts[0].slice(-2).split('').map(mapChar).join('')}-${parseInt(parts[1], 10).toString().split('').map(mapChar).join('')}`;
        };

        printList.forEach(item => {
            const sessionCode = item.sessionCodeInt; // Angka sesuai sesi
            const fullBarcode = buildShortBarcode(item, item.printDate, 'ONLINE', sessionCode);
            const prodCode = getProductionCode(item.printDate);
            const priceStr = "Rp. " + Number(item.sellPrice || 0).toLocaleString('id-ID');
            const photoHtml = item.photo ? `<img class="photo" src="${item.photo}" />` : `<div style="font-size:10px;">No Img</div>`;
            const dateMarkerText = item.printDate.split('-')[2]; // Hanya tanggal (DD)

            let displayArt = item.article;

            htmlContent += `
                <div class="label-container">
                  <div class="label-grid">
                    <div class="cell br bb" style="position: relative;">
                        <div class="date-marker" style="position: absolute; top: 2px; left: 2px; font-size: 20px; font-weight: 900; color: white; background: black; padding: 2px 8px; border-radius: 4px; z-index: 20; text-transform: uppercase;">${dateMarkerText}</div>
                        ${photoHtml}
                    </div>
                    <div class="cell br bb" style="flex-direction: column; padding: 10px;"><svg class="barcode-svg" jsbarcode-value="${fullBarcode}" jsbarcode-format="CODE128" jsbarcode-width="2" jsbarcode-height="55" jsbarcode-displayvalue="false" jsbarcode-margin="0" jsbarcode-fontsize="14"></svg></div>
                    <div class="cell bb">
                      <div class="prod-container">
                        <div class="prod-code">${prodCode}-</div>
                        <div class="prod-session">${sessionCode}</div>
                      </div>
                    </div>
                    <div class="cell br" style="flex-direction: column;"><div class="size-text">${item.sizeName}</div><div class="color-text">${item.colorName}</div></div>
                    <div class="cell br" style="flex-direction: column;"><div class="article-text">${displayArt}</div><div class="price-text">${priceStr}</div></div>
                    <div class="cell"><div class="qrcode-target" data-value="${fullBarcode}"></div></div>
                  </div>
                </div>
              `;
        });

        htmlContent += `
                <script>
                  window.onload = function() {
                    if(window.JsBarcode) JsBarcode(".barcode-svg").init();
                    if(window.QRCode) {
                       var qrcodes = document.querySelectorAll('.qrcode-target');
                       qrcodes.forEach(function(el) { new QRCode(el, { text: el.getAttribute('data-value'), width: 70, height: 70, colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.L }); });
                    }
                    setTimeout(() => { window.print(); }, 800);
                  };
                <\/script>
              </body>
              </html>
            `;
        printWindow.document.open(); printWindow.document.write(htmlContent); printWindow.document.close();
    };


    const handleMassBatasKirim = () => {
        if (!massBatasKirim) return showToast('error', 'Silakan pilih tanggal batas kirim terlebih dahulu!');
        
        const newEditedItems = { ...editedResiItems };
        let updatedCount = 0;
        
        Object.values(resiPreviews).forEach(order => {
            // Terapkan jika tab "Semua" aktif ATAU jika platform item cocok dengan tab yang aktif
            if (activePreviewTab === 'PREV-ALL' || order.platform.toUpperCase() === activePreviewTab.replace('PREV-', '')) {
                // Set edit untuk setiap item dalam resi tersebut (meskipun shipDate biasanya per resi, kita ikuti format state)
                newEditedItems[`${order.id}-shipDate`] = massBatasKirim;
                updatedCount++;
            }
        });
        
        setEditedResiItems(newEditedItems);
        setHasEdits(true);
        setMassBatasKirim('');
        showToast('success', `Berhasil mengupdate batas kirim untuk ${updatedCount} pesanan!`);
    };

    const handleSiapkanQC = async () => {
        if (!analysisResult || analysisResult.qcOrdersQueue.length === 0) return;
        setIsLoading(true);
        try {
            const batchTimestamp = Date.now();
            const batch = db.batch();
            analysisResult.qcOrdersQueue.forEach(order => {
                const docRef = db.collection('qc_orders').doc(order.id);
                // LOGIKA BARU: Pasang gembok (isReleasedToProduction: false), Simpan Sesi, dan batchTimestamp
                batch.set(docRef, {
                    ...order,
                    status: 'PENDING',
                    poDate: poDraftDate,
                    session: poSession,
                    batchTimestamp: batchTimestamp,
                    isReleasedToProduction: false,
                    isCanceled: false
                }, { merge: true });
            });

            // Update Status Manual Orders ke 'direkap'
            if (includedManualOrderIds.length > 0) {
                includedManualOrderIds.forEach(id => {
                    batch.update(db.collection('manual_orders').doc(id), { status: 'direkap', processedAt: new Date().toISOString() });
                });
                setIncludedManualOrderIds([]); // Reset state
            }

            await batch.commit();

            // 1. Upload unique files to Cloudinary and get URLs
            setIsGeneratingPdf(true);
            const uniqueFilesMap = new Map();
            pdfTrackingData.forEach(track => {
                const uName = track.uniqueFileName || (track.file ? track.file.name : '');
                if (track.file && !uniqueFilesMap.has(uName)) {
                    const renamedFile = new File([track.file], uName, { type: track.file.type });
                    uniqueFilesMap.set(uName, renamedFile);
                }
            });
            const uniqueFiles = Array.from(uniqueFilesMap.values());
            const uploadedUrls = [];
            
            if (uniqueFiles.length > 0) {
                showToast('info', `Mengunggah PDF ke Cloudinary...`, 3000);
                const uploadPromises = uniqueFiles.map(async (file) => {
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('upload_preset', 'gudang_pdf');
                    try {
                        const response = await fetch('https://api.cloudinary.com/v1_1/dfcfebwrk/auto/upload', {
                            method: 'POST',
                            body: formData
                        });
                        const data = await response.json();
                        if (data.secure_url) {
                            return { name: file.name, url: data.secure_url };
                        }
                        console.error('Cloudinary upload gagal untuk', file.name, ':', data.error || data);
                        return null;
                    } catch (err) {
                        console.error('Cloudinary upload network error untuk', file.name, ':', err);
                        return null;
                    }
                });
                const results = await Promise.all(uploadPromises);
                results.forEach(r => { if (r) uploadedUrls.push(r); });
                const failCount = results.filter(r => !r).length;
                if (failCount > 0) {
                    showToast('error', `${failCount} dari ${uniqueFiles.length} file gagal diupload ke Cloudinary. Cetak resi dari riwayat mungkin tidak bekerja.`, 5000);
                }
            }

            // 2. Prepare PDF tracking info with Cloudinary URLs
            const trackingInfoToSave = pdfTrackingData.map(t => {
                const fName = t.uniqueFileName || (t.file ? t.file.name : '');
                const matchedUrl = uploadedUrls.find(u => u.name === fName);
                // Embed status READY/PO langsung ke tracking info supaya bisa filter tanpa query qc_orders
                const order = analysisResult.qcOrdersQueue.find(o => o.id === t.resi);
                const hasPO = order ? (order.items || []).some(it => it.status === 'PO' || it.status === 'UNRECOGNIZED') : false;
                return {
                    resi: t.resi,
                    platform: t.platform,
                    pageIndex: t.pageIndex,
                    fileName: fName,
                    url: matchedUrl ? matchedUrl.url : null,
                    itemStatus: hasPO ? 'PO' : 'READY'
                };
            });
            setIsGeneratingPdf(false);

            // Juga update state legacy (untuk backward compatibility sementara sebelum cetak current resi)
            setDraftPdfTrackingData(prev => {
                const existingResi = new Set(prev.map(p => p.resi));
                const newItems = pdfTrackingData.filter(p => !existingResi.has(p.resi));
                return [...prev, ...newItems];
            });
            // Auto-simpan PO saat ini ke antrian (jika ada)
            if (analysisResult.poList && analysisResult.poList.length > 0) {
                try {
                    const resiOnline = (platformStats?.shopee?.resi || 0) + (platformStats?.tiktok?.resi || 0) + (platformStats?.lazada?.resi || 0) + (platformStats?.affiliate?.resi || 0);
                    const resiAll = resiOnline + (includeManual ? (platformStats?.manual?.resi || 0) : 0) + (platformStats?.affiliate_tiktok?.resi || 0);
                    const pcsOnline = (platformStats?.shopee?.pcs || 0) + (platformStats?.tiktok?.pcs || 0) + (platformStats?.lazada?.pcs || 0);
                    const pcsAll = pcsOnline + (includeManual ? (platformStats?.manual?.pcs || 0) : 0) + (platformStats?.affiliate_tiktok?.pcs || 0);
                    await window.db.collection('po_drafts').add({
                        savedAt: new Date().toISOString(),
                        targetDate: poDraftDate,
                        session: poSession,
                        totalResiAll: resiAll,
                        totalResiOnline: resiOnline,
                        totalPcsAll: pcsAll,
                        totalPcsOnline: pcsOnline,
                        items: analysisResult.poList.map(item => ({
                            article: item.variant.article,
                            colorName: item.variant.colorName,
                            sizeName: item.variant.sizeName,
                            missingQty: item.missingQty,
                            isUrgent: item.isUrgent || false
                        })),
                        pdfTrackingInfo: trackingInfoToSave
                    });
                    await loadPODrafts();
                } catch (pe) { console.error('Gagal auto-save PO draft:', pe); }
            }

            // Auto-simpan Ready saat ini ke antrian (jika ada)
            if (analysisResult.readyList && analysisResult.readyList.length > 0) {
                try {
                    await window.db.collection('ready_drafts').add({
                        savedAt: new Date().toISOString(),
                        targetDate: poDraftDate,
                        session: poSession,
                        batchTimestamp: batchTimestamp,
                        totalResi: analysisResult.readyList.length,
                        totalPcs: analysisResult.readyList.reduce((a, c) => a + c.qty, 0),
                        items: analysisResult.readyList.map(item => ({
                            resiId: item.id,
                            platform: item.platform,
                            items: item.items
                        })),
                        pdfTrackingInfo: trackingInfoToSave
                    });
                    await loadReadyDrafts();
                } catch (re) { console.error('Gagal auto-save Ready draft:', re); }
            }

            playConfirm();
            showToast('success', `${analysisResult.qcOrdersQueue.length} Resi berhasil dikirim ke Antrean QC!`);
        } catch (e) {
            showToast('error', e.message);
        }
        setIsLoading(false);
    };

    const getFifoBatches = (sku, neededQty) => {
        const stockMap = {};
        transactions.forEach(t => {
            if (t.sku !== sku || !t.fullBarcode) return;

            // EKSTRAK TANGGAL ASLI DARI BARCODE (Abaikan Suffix * atau #)
            let rawBase = t.fullBarcode;
            if (rawBase.includes('#')) rawBase = rawBase.split('#')[0];
            if (rawBase.includes('*')) rawBase = rawBase.split('*')[0];
            const dateStr = rawBase.length > 8 ? rawBase.slice(-8) : "20240101";

            if (!stockMap[t.fullBarcode]) stockMap[t.fullBarcode] = { in: 0, out: 0, dateStr: dateStr };
            if (t.type === 'IN' || t.type === 'REVISI_IN') stockMap[t.fullBarcode].in += t.qty;
            if (t.type === 'OUT' || t.type === 'REVISI_OUT') stockMap[t.fullBarcode].out += t.qty;
        });
        const availableBatches = Object.keys(stockMap)
            .map(barcode => {
                const sisa = stockMap[barcode].in - stockMap[barcode].out;
                const recordDate = `${stockMap[barcode].dateStr.slice(0, 4)}-${stockMap[barcode].dateStr.slice(4, 6)}-${stockMap[barcode].dateStr.slice(6, 8)}T00:00:00`;
                return { barcode, sisa, recordDate };
            })
            .filter(b => b.sisa > 0)
            .sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate));

        let remainingToPick = neededQty;
        const pickedBatches = [];
        for (const batch of availableBatches) {
            if (remainingToPick <= 0) break;
            const take = Math.min(batch.sisa, remainingToPick);
            const mapChar = (char) => ({ '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', '6': 'F', '7': 'G', '8': 'H', '9': 'I', '0': 'J' }[char] || char);
            const y = batch.recordDate.split('-')[0].slice(-2).split('').map(mapChar).join('');
            const m = parseInt(batch.recordDate.split('-')[1], 10).toString().split('').map(mapChar).join('');
            pickedBatches.push(`${y}-${m}`);
            remainingToPick -= take;
        }
        return [...new Set(pickedBatches)].join(', ');
    };

    // FUNGSI PRINT PICKING LIST (DAFTAR AMBIL) - PDF A4
    // FUNGSI DOWNLOAD PDF HELPER (Otomatis Load Library html2pdf)
    // FUNGSI DOWNLOAD PDF HELPER (Otomatis Load Library html2pdf)
    // FUNGSI DOWNLOAD PDF HELPER (Otomatis Load Library html2pdf)
    // FUNGSI DOWNLOAD PDF MENGGUNAKAN JSPDF (NATIVE PDF - ANTI BLANK)
    const loadJsPdf = async () => {
        if (!window.jspdf) {
            await new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
        if (!window.jspdf.AutoTable) {
            await new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
    };

    // FUNGSI 1: DOWNLOAD PDF PICKING LIST (DAFTAR AMBIL)
    const handlePrintPickingList = async () => {
        if (!analysisResult || analysisResult.readyList.length === 0) return showToast('error', "Daftar kosong");
        setIsLoading(true);
        try {
            await loadJsPdf();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');

            const dateStr = new Date().toISOString().split('T')[0];
            const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

            doc.setFontSize(16);
            doc.text('Daftar barang yang ada di stok', 14, 20);
            doc.setFontSize(10);
            doc.text(`Tanggal: ${dateStr}`, 14, 28);
            doc.text(`Jam: ${timeStr}`, 14, 34);

            const tableData = [];
            Object.keys(groupedPicking).forEach(article => {
                const items = groupedPicking[article];
                items.forEach((item, idx) => {
                    const fifoCodes = getFifoBatches(item.variant.sku, item.qty);
                    tableData.push([
                        idx === 0 ? article : '',
                        item.variant.colorName,
                        item.variant.sizeName,
                        item.qty.toString(),
                        fifoCodes,
                        ''
                    ]);
                });
            });

            doc.autoTable({
                startY: 40,
                head: [['Article', 'Warna', 'Size', 'Quantity', 'Kode Tahun', 'Keterangan']],
                body: tableData,
                theme: 'grid',
                headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', halign: 'center' },
                bodyStyles: { halign: 'center', valign: 'middle', textColor: 0 },
                columnStyles: {
                    0: { fontStyle: 'bold', halign: 'left' },
                    3: { fontStyle: 'bold', fontSize: 12 }
                }
            });

            doc.save(`Daftar_Ambil_${dateStr}.pdf`);
            showToast('success', 'PDF Daftar Ambil berhasil diunduh!');
        } catch (err) {
            showToast('error', 'Gagal membuat PDF.');
            console.error(err);
        }
        setIsLoading(false);
    };

    // FUNGSI 2: PRINT STIKER LABEL PO (TETAP CETAK BIASA)
    const handlePrintLabelsPO = () => {
        if (!analysisResult || analysisResult.poList.length === 0) return showToast('error', "Daftar PO kosong");
        const printWindow = window.open('', '_blank');
        if (!printWindow) return showToast('error', "Gagal membuka tab baru. Izinkan Pop-up Blocker!");

        const printDate = poDraftDate; // Menggunakan Input Date Picker PO
        let printList = [];
        analysisResult.poList.forEach(item => {
            for (let i = 0; i < item.missingQty; i++) {
                printList.push({ ...item.variant, printDate: printDate });
            }
        });

        let htmlContent = `
              <!DOCTYPE html>
              <html>
              <head>
                <title>Stiker_PO_${printDate}</title>
                <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
                <style>
                  @page { margin: 0; }
                  body { margin: 0; padding: 0; font-family: sans-serif; background-color: white; }
                  .label-container { width: 471px; height: 215px; margin: 5px; padding: 0; border: none; box-sizing: border-box; page-break-after: always; page-break-inside: avoid; overflow: hidden; background-color: white; display: flex; justify-content: center; align-items: center; }
                  .label-grid { width: 100%; height: 100%; border: 2px solid black; display: grid; grid-template-columns: 1.4fr 2.4fr 0.9fr; grid-template-rows: 1fr 1fr; box-sizing: border-box; }
                  .cell { display: flex; justify-content: center; align-items: center; padding: 5px; box-sizing: border-box; text-align: center; overflow: hidden; }
                  .br { border-right: 1px solid black; }
                  .bb { border-bottom: 1px solid black; }
                  .photo { max-width: 100%; max-height: 100%; object-fit: contain; }
                  .barcode-svg { max-width: 100%; max-height: 100%; }
                  .size-text { font-size: 50px; font-weight: 900; line-height: 1; margin-bottom: 2px; }
                  .color-text { font-size: 16px; font-weight: bold; text-transform: uppercase; margin-top: 2px; }
                  /* PROD CODE + SESSION */
                  .prod-container { display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; }
                  .prod-code { font-size: 34px; font-weight: 900; letter-spacing: 1px; }
                  .prod-session { font-size: 30px; font-weight: 900; letter-spacing: 1px; }
                  
                  .article-text { font-size: 20px; font-weight: 900; }
                  .price-text { font-size: 14px; font-weight: bold; margin-top: 4px; }
                </style>
              </head>
              <body>
            `;

        const getProductionCode = (dateString) => {
            if (!dateString) return "";
            const parts = dateString.split('T')[0].split('-');
            if (parts.length !== 3) return "";
            const mapChar = (char) => ({ '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', '6': 'F', '7': 'G', '8': 'H', '9': 'I', '0': 'J' }[char] || char);
            return `${parts[0].slice(-2).split('').map(mapChar).join('')}-${parseInt(parts[1], 10).toString().split('').map(mapChar).join('')}`;
        };

        const sessionCode = poSession;
        const dateMarkerText = `${printDate.split('-').reverse().slice(0, 2).join('/')} SESI ${sessionCode}`;

        printList.forEach(item => {
            const fullBarcode = buildShortBarcode(item, item.printDate, 'ONLINE', sessionCode);
            const prodCode = getProductionCode(item.printDate);
            const priceStr = "Rp. " + Number(item.sellPrice || 0).toLocaleString('id-ID');
            const photoHtml = item.photo ? `<img class="photo" src="${item.photo}" />` : `<div style="font-size:10px;">No Img</div>`;

            // Singkat Article F07- untuk Stiker (Dibatalkan sesuai permintaan: tetap full F07-)
            let displayArt = item.article;

            htmlContent += `
                <div class="label-container">
                  <div class="label-grid">
                    <div class="cell br bb" style="position: relative;">
                        <div class="date-marker" style="position: absolute; top: 2px; left: 2px; font-size: 8px; font-weight: black; color: white; background: black; padding: 1px 4px; border-radius: 2px; z-index: 20; text-transform: uppercase;">${dateMarkerText}</div>
                        ${photoHtml}
                    </div>
                    <div class="cell br bb" style="flex-direction: column; padding: 10px;"><svg class="barcode-svg" jsbarcode-value="${fullBarcode}" jsbarcode-format="CODE128" jsbarcode-width="2" jsbarcode-height="55" jsbarcode-displayvalue="false" jsbarcode-margin="0" jsbarcode-fontsize="14"></svg></div>
                    <div class="cell bb">
                      <div class="prod-container">
                        <div class="prod-code">${prodCode}-</div>
                        <div class="prod-session">${sessionCode}</div>
                      </div>
                    </div>
                    <div class="cell br" style="flex-direction: column;"><div class="size-text">${item.sizeName}</div><div class="color-text">${item.colorName}</div></div>
                    <div class="cell br" style="flex-direction: column;"><div class="article-text">${displayArt}</div><div class="price-text">${priceStr}</div></div>
                    <div class="cell"><div class="qrcode-target" data-value="${fullBarcode}"></div></div>
                  </div>
                </div>
              `;
        });

        htmlContent += `
                <script>
                  window.onload = function() {
                    if(window.JsBarcode) JsBarcode(".barcode-svg").init();
                    if(window.QRCode) {
                       var qrcodes = document.querySelectorAll('.qrcode-target');
                       qrcodes.forEach(function(el) { new QRCode(el, { text: el.getAttribute('data-value'), width: 70, height: 70, colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.L }); });
                    }
                    setTimeout(() => { window.print(); }, 800);
                  };
                <\/script>
              </body>
              </html>
            `;
        printWindow.document.open(); printWindow.document.write(htmlContent); printWindow.document.close();
    };

    const groupedPicking = {};
    if (analysisResult) {
        analysisResult.readyList.forEach(item => {
            const art = item.variant.article;
            if (!groupedPicking[art]) groupedPicking[art] = [];
            groupedPicking[art].push(item);
        });
    }

    // FUNGSI 3: DOWNLOAD PDF PO KERTAS 
    const handlePrint = async () => {
        if (!analysisResult || analysisResult.poList.length === 0) return showToast('error', "Daftar PO kosong");
        setIsLoading(true);
        try {
            await loadJsPdf();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            const dateStr = new Date().toISOString().split('T')[0];

            doc.setFontSize(22);
            doc.setTextColor(220, 38, 38); // Warna Merah
            doc.setFont('times', 'bold');
            doc.text('PESANAN ONLINE FARADELA OFFICIAL', 105, 18, { align: 'center' });

            const poDateObj = new Date(poDraftDate);
            const formattedDate = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(poDateObj);

            const dateText = `${formattedDate} (SESI ${poSession})`;

            doc.setFontSize(16);
            doc.setTextColor(220, 38, 38);
            doc.setFont('times', 'italic');
            doc.text(dateText, 105, 27, { align: 'center' });

            // Kotak Merah mengelilingi Tanggal (menyesuaikan ukuran lebar text)
            const textWidth = doc.getTextWidth(dateText);
            doc.setDrawColor(220, 38, 38);
            doc.setLineWidth(0.8);
            doc.rect(105 - (textWidth / 2) - 5, 20.5, textWidth + 10, 9); // x, y, w, h

            const tableData = [];
            // Kita tidak perlu kolom Date terpisah dan rowSpan Date lagi, karena sudah di judul.
            analysisResult.poList.forEach((item, idx) => {
                let displayArt = item.variant.article;
                if (displayArt.toUpperCase().startsWith('F07-')) {
                    // PERBAIKAN: Jangan hapus akhiran .1 / .2 karena itu adalah pembeda produk yang terpisah
                    displayArt = displayArt.substring(4).replace(/^0+/, '');
                }
                tableData.push([
                    displayArt,
                    item.variant.colorName,
                    item.variant.sizeName,
                    item.missingQty.toString()
                ]);
            });

            const totalQty = analysisResult.poList.reduce((a, c) => a + c.missingQty, 0);
            tableData.push(['TOTAL', '', '', totalQty.toString()]);

            doc.autoTable({
                startY: 40,
                head: [['ARTICLE', 'COLOUR', 'SIZE', 'JUMLAH']],
                body: tableData,
                theme: 'grid',
                styles: { font: 'times', fontSize: 13, textColor: 0, halign: 'center', valign: 'middle', lineColor: 0, lineWidth: 0.5 },
                headStyles: { fillColor: [226, 239, 218], fontStyle: 'bold' },
                didParseCell: function (data) {
                    if (data.section === 'body') {
                        if (data.row.index === tableData.length - 1) { // Baris Total Akhir
                            data.cell.styles.fontStyle = 'bold';
                            data.cell.styles.fontSize = 16;
                            if (data.column.index === 3) data.cell.styles.textColor = [220, 38, 38];
                            if (data.column.index === 0) {
                                data.cell.colSpan = 3;
                                data.cell.styles.halign = 'center';
                            }
                        } else {
                            const item = analysisResult.poList[data.row.index];
                            if (item && item.isUrgent) {
                                data.cell.styles.textColor = [220, 38, 38]; // Merah jika URGENT
                                data.cell.styles.fontStyle = 'bold';
                            }
                        }
                    }
                }
            });

            doc.save(`PO_Produksi_${dateStr}.pdf`);
            showToast('success', 'PDF PO berhasil diunduh!');
        } catch (err) {
            showToast('error', 'Gagal membuat PDF.');
            console.error(err);
        }
        setIsLoading(false);
    };


    const FileBox = ({ title, accept, files, onUpload, onRemove, icon, colorClass, borderClass, bgClass, stats }) => (
        <div className={`border-2 rounded-2xl p-5 ${borderClass} ${bgClass} relative overflow-hidden flex flex-col h-full`}>
            <i className={`fa-solid ${icon} absolute -bottom-4 -right-4 text-7xl opacity-5 ${colorClass}`}></i>
            <div className="relative z-10 flex-1 flex flex-col">
                <h3 className={`font-black text-lg mb-3 flex items-center gap-2 ${colorClass}`}><i className={`fa-solid ${icon}`}></i> {title}</h3>
                <input type="file" multiple accept={accept} onChange={onUpload} className="w-full text-xs font-bold text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-white file:shadow-sm cursor-pointer mb-3" />
                <div className="flex-1 max-h-24 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {files.map((f, i) => (
                        <div key={i} className="flex justify-between items-center text-[11px] bg-white/70 p-2 rounded-lg border border-white"><span className="truncate pr-2 font-mono font-bold text-slate-700">{f.name}</span><button onClick={() => onRemove(i)} className="text-rose-500 hover:bg-rose-100 w-5 h-5 rounded flex items-center justify-center transition-colors"><i className="fa-solid fa-xmark"></i></button></div>
                    ))}
                </div>
                {stats && (
                    <div className="mt-4 pt-3 border-t border-slate-200/50 flex justify-between items-center">
                        <div className="text-center w-1/2 border-r border-slate-200/50"><div className={`text-[10px] font-black uppercase ${colorClass} opacity-70`}>Total Resi</div><div className={`text-2xl font-black ${colorClass}`}>{stats.resi}</div></div>
                        <div className="text-center w-1/2"><div className={`text-[10px] font-black uppercase ${colorClass} opacity-70`}>Total Barang</div><div className={`text-2xl font-black ${colorClass}`}>{stats.pcs}</div></div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-white p-6 md:p-8 rounded-3xl shadow-xl border border-slate-200 no-print">
                <div className="mb-6 text-center"><h2 className="text-3xl font-black text-slate-800 flex items-center justify-center gap-3 mb-2"><i className="fa-solid fa-server text-orange-500"></i> Generator Rekapan Pesanan </h2></div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-4">
                    {/* KOTAK SHOPEE SEKARANG MENERIMA PDF (Shopee Seller Centre) */}
                    <FileBox title="Shopee (PDF)" accept=".pdf" files={shopeeFiles} onUpload={handleUploadShopee} onRemove={(i) => setShopeeFiles(p => p.filter((_, idx) => idx !== i))} icon="fa-bag-shopping" colorClass="text-orange-600" borderClass="border-orange-200" bgClass="bg-orange-50" stats={platformStats?.shopee} />
                    {/* KOTAK TIKTOK & LAZADA HANYA MENERIMA PDF */}
                    <FileBox title="TikTok (PDF)" accept=".pdf" files={tiktokFiles} onUpload={handleUploadTiktok} onRemove={(i) => setTiktokFiles(p => p.filter((_, idx) => idx !== i))} icon="fa-music" colorClass="text-slate-800" borderClass="border-slate-300" bgClass="bg-slate-100" stats={platformStats?.tiktok} />
                    <FileBox title="Lazada (PDF)" accept=".pdf" files={lazadaFiles} onUpload={handleUploadLazada} onRemove={(i) => setLazadaFiles(p => p.filter((_, idx) => idx !== i))} icon="fa-heart" colorClass="text-orange-500" borderClass="border-orange-200" bgClass="bg-orange-50" stats={platformStats?.lazada} />
                    <FileBox title="Affiliate TikTok (PDF)" accept=".pdf" files={affiliateTiktokFiles} onUpload={handleUploadAffiliateTiktok} onRemove={(i) => setAffiliateTiktokFiles(p => p.filter((_, idx) => idx !== i))} icon="fa-music" colorClass="text-purple-600" borderClass="border-purple-200" bgClass="bg-purple-50" stats={platformStats?.affiliate_tiktok} />
                </div>

                {/* CHECKBOX MANUAL ORDERS */}
                <div className="mb-6 p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between shadow-sm cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => setIncludeManual(!includeManual)}>
                    <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-colors ${includeManual ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-300 text-transparent'}`}>
                            <i className="fa-solid fa-check text-sm"></i>
                        </div>
                        <div>
                            <div className="font-bold text-slate-700 select-none">Sertakan Pesanan Manual (Draft) ke GRPA</div>
                            <div className="text-xs text-slate-500 select-none">{manualOrders.filter(o => o.status === 'draft').length} pesanan menunggu diproses</div>
                        </div>
                    </div>
                    {platformStats?.manual && <div className="text-sm font-black text-emerald-600 hidden md:flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200"><i className="fa-solid fa-check-circle"></i> {platformStats.manual.resi} Pesanan Terbaca</div>}
                </div>

                <button type="button" onClick={processAllPlatforms} className="w-full bg-orange-500 hover:bg-orange-600 text-white py-4 font-black text-lg md:text-xl rounded-2xl shadow-lg shadow-orange-500/30 transition-transform transform hover:-translate-y-1 mb-4"><i className="fa-solid fa-bolt mr-3 text-xl"></i> GABUNGKAN &amp; ANALISIS SEMUA PESANAN</button>

                {analysisResult && (
                    <div className="flex flex-col gap-4 no-print mt-4">
                        <div className="w-full">
                            <button onClick={handleSiapkanQC} className="w-full bg-slate-800 hover:bg-slate-900 text-white py-3.5 font-black text-base rounded-xl shadow-lg transition-transform transform hover:-translate-y-1">
                                <i className="fa-solid fa-paper-plane mr-2"></i> SIAPKAN UNTUK TIM QC
                            </button>
                        </div>

                        {analysisResult && analysisResult.summary.totalResi > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                                <button onClick={() => handlePrintCurrentResi('ready')} disabled={analysisResult.readyList.length === 0 || isGeneratingPdf}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white py-3 font-black text-sm rounded-xl shadow-md transition-all transform hover:-translate-y-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale">
                                    <i className="fa-solid fa-tags"></i> {isGeneratingPdf ? 'MENYIAPKAN...' : 'CETAK RESI SHIPPING (READY SAJA)'}
                                </button>
                                <button onClick={() => handlePrintCurrentResi('all')} disabled={isGeneratingPdf}
                                    className="bg-orange-600 hover:bg-orange-700 text-white py-3 font-black text-sm rounded-xl shadow-md transition-all transform hover:-translate-y-1 flex items-center justify-center gap-2">
                                    <i className="fa-solid fa-layer-group"></i> {isGeneratingPdf ? 'MENYIAPKAN...' : 'CETAK SEMUA RESI (READY + PO)'}
                                </button>
                            </div>
                        )}

                        {/* PENGATURAN TANGGAL & SESI PO DIPINDAHKAN KE SINI */}
                        <div className="flex items-center gap-3 bg-orange-50 border-2 border-orange-200 rounded-xl p-3 flex-wrap justify-center shadow-inner">
                            <i className="fa-solid fa-calendar-days text-orange-500 text-lg"></i>
                            <span className="text-sm font-black text-orange-800 uppercase tracking-wider">Tgl Psn online & Sesi:</span>
                            <input type="date" value={poDraftDate} onChange={e => setPoDraftDate(e.target.value)}
                                className="text-sm font-bold bg-white border-2 border-orange-300 rounded-lg px-3 py-1.5 outline-none text-slate-700 cursor-pointer focus:border-orange-500" />
                            <span className="text-orange-300 mx-1 font-black">|</span>
                            <div className="flex gap-1.5 flex-wrap">
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => (
                                    <button key={s} onClick={() => setPoSession(s)}
                                        className={`w-9 h-9 rounded-lg text-sm font-black transition-all ${poSession === s ? 'bg-orange-500 text-white shadow-md transform scale-110' : 'bg-white border-2 border-orange-200 text-orange-600 hover:bg-orange-100'}`}>
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* MODAL PREVIEW RESI (FITUR BARU) - TABEL EDITABLE */}
            {showResiPreview && Object.keys(resiPreviews).length > 0 && (
                <div className="bg-white p-6 md:p-8 rounded-3xl shadow-xl border border-blue-200 no-print">
                    <div className="mb-6 text-center">
                        <h2 className="text-3xl font-black text-slate-800 flex items-center justify-center gap-3 mb-2">
                            <i className="fa-solid fa-magnifying-glass text-blue-500"></i> Daftar Resi Pesanan
                        </h2>
                        <p className="text-sm text-slate-600">Edit kolom Article, Warna, Size, dan Batas Kirim jika diperlukan sebelum melakukan rekap</p>
                    </div>

                    {/* TAB PLATFORM FILTER & MASS UPDATE */}
                    <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6 pb-2">
                        <div className="flex overflow-x-auto gap-2 custom-scrollbar max-w-full pb-2 xl:pb-0">
                            <button onClick={() => setActivePreviewTab('PREV-ALL')} className={`flex-shrink-0 px-6 py-3 rounded-xl font-black transition-all whitespace-nowrap ${activePreviewTab === 'PREV-ALL' ? 'bg-blue-600 text-white shadow-md' : 'bg-blue-50 text-blue-600 border-2 border-blue-200 hover:bg-blue-100'}`}>
                                <i className="fa-solid fa-list mr-2"></i> Semua ({Object.keys(resiPreviews).length})
                            </button>
                            {platformStats?.shopee && platformStats.shopee.resi > 0 && (
                                <button onClick={() => setActivePreviewTab('PREV-SHOPEE')} className={`flex-shrink-0 px-6 py-3 rounded-xl font-black transition-all whitespace-nowrap ${activePreviewTab === 'PREV-SHOPEE' ? 'bg-orange-600 text-white shadow-md' : 'bg-orange-50 text-orange-600 border-2 border-orange-200 hover:bg-orange-100'}`}>
                                    <i className="fa-solid fa-bag-shopping mr-2"></i> Shopee ({platformStats.shopee.resi})
                                </button>
                            )}
                            {platformStats?.tiktok && platformStats.tiktok.resi > 0 && (
                                <button onClick={() => setActivePreviewTab('PREV-TIKTOK')} className={`flex-shrink-0 px-6 py-3 rounded-xl font-black transition-all whitespace-nowrap ${activePreviewTab === 'PREV-TIKTOK' ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-100 text-slate-700 border-2 border-slate-300 hover:bg-slate-200'}`}>
                                    <i className="fa-solid fa-music mr-2"></i> TikTok ({platformStats.tiktok.resi})
                                </button>
                            )}
                            {platformStats?.lazada && platformStats.lazada.resi > 0 && (
                                <button onClick={() => setActivePreviewTab('PREV-LAZADA')} className={`flex-shrink-0 px-6 py-3 rounded-xl font-black transition-all whitespace-nowrap ${activePreviewTab === 'PREV-LAZADA' ? 'bg-orange-600 text-white shadow-md' : 'bg-orange-50 text-orange-600 border-2 border-orange-200 hover:bg-orange-100'}`}>
                                    <i className="fa-solid fa-heart mr-2"></i> Lazada ({platformStats.lazada.resi})
                                </button>
                            )}
                            {platformStats?.manual && platformStats.manual.resi > 0 && (
                                <button onClick={() => setActivePreviewTab('PREV-MANUAL')} className={`flex-shrink-0 px-6 py-3 rounded-xl font-black transition-all whitespace-nowrap ${activePreviewTab === 'PREV-MANUAL' ? 'bg-emerald-600 text-white shadow-md' : 'bg-emerald-50 text-emerald-600 border-2 border-emerald-200 hover:bg-emerald-100'}`}>
                                    <i className="fa-solid fa-file-invoice mr-2"></i> Manual ({platformStats.manual.resi})
                                </button>
                            )}
                        </div>
                    </div>

                    {/* TABEL DAFTAR RESI EDITABLE */}
                    <div className="overflow-x-auto border border-slate-300 rounded-2xl mb-6">
                        <table className="w-full border-collapse bg-white">
                            <thead>
                                <tr className="bg-blue-50 border-b-2 border-blue-300">
                                    <th className="px-4 py-3 text-left font-black text-slate-800 border-r border-slate-300 w-40">Nomer Resi</th>
                                    <th className="px-4 py-3 text-left font-black text-slate-800 border-r border-slate-300 flex-1">SKU</th>
                                    <th className="px-4 py-3 text-left font-black text-slate-800 border-r border-slate-300">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between">
                                                <span>Batas Kirim</span>
                                            </div>
                                            <div className="flex items-center gap-1 bg-white border border-slate-300 rounded overflow-hidden">
                                                <input type="date" 
                                                    value={massBatasKirim} 
                                                    onChange={e => setMassBatasKirim(e.target.value)} 
                                                    className="text-[10px] font-bold bg-transparent px-1 py-1 outline-none text-slate-700 w-full" 
                                                    title="Pilih tanggal massal"
                                                />
                                                <button onClick={handleMassBatasKirim} className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black py-1 px-2 cursor-pointer border-l border-blue-700" title="Terapkan ke Semua">
                                                    <i className="fa-solid fa-check"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </th>
                                    <th className="px-4 py-3 text-left font-black text-slate-800 border-r border-slate-300 flex-1">Catatan</th>
                                    <th className="px-4 py-3 text-center font-black text-slate-800 w-20">Qty</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.values(resiPreviews)
                                    .filter(order => {
                                        if (activePreviewTab === 'PREV-SHOPEE') return order.platform === 'SHOPEE';
                                        if (activePreviewTab === 'PREV-TIKTOK') return order.platform === 'TIKTOK';
                                        if (activePreviewTab === 'PREV-LAZADA') return order.platform === 'LAZADA';
                                        if (activePreviewTab === 'PREV-MANUAL') return order.platform === 'MANUAL';
                                        return true;
                                    })
                                    .flatMap((order, orderIdx) =>
                                        order.items.map((item, itemIdx) => {
                                            const editKey = `${order.id}-${itemIdx}`;
                                            const editedData = editedResiItems[editKey] || {};
                                            const isEdited = !!editedResiItems[editKey];
                                            const shipDateEdit = editedResiItems[`${order.id}-shipDate`];
                                            const shipDateDisplay = shipDateEdit || (order.shipDate ? new Date(order.shipDate).toISOString().split('T')[0] : '');

                                            // Tentukan apakah resi ini ada item/tanggal yang diedit
                                            const isShipDateEdited = !!shipDateEdit;
                                            const catatanEdit = editedResiItems[`${order.id}-catatan`];
                                            const isCatatanEdited = !!catatanEdit;
                                            const isAnyEdited = isEdited || isShipDateEdited || isCatatanEdited;

                                            return (
                                                <tr key={`${orderIdx}-${itemIdx}`} className={`border-b border-slate-200 text-sm ${isAnyEdited ? 'bg-yellow-50' : ''}`}>
                                                    <td className="px-4 py-3 font-mono font-bold text-slate-800 border-r border-slate-300 align-top">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span>{order.id}</span>
                                                            {isAnyEdited && <span className="inline-block bg-yellow-400 text-yellow-900 text-[9px] font-black px-1.5 py-0.5 rounded">ed</span>}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-300">
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="text"
                                                                defaultValue={editedData.sku || item.sku}
                                                                onChange={(e) => handleEditResiItem(order.id, itemIdx, 'sku', e.target.value)}
                                                                className={`flex-1 px-2 py-1 border rounded text-sm font-mono ${isEdited ? 'border-yellow-500 bg-yellow-100' : 'border-slate-300'}`}
                                                            />
                                                            {isEdited && <span className="inline-block bg-orange-400 text-white text-[8px] font-black px-1 py-0.5 rounded flex-shrink-0">ed</span>}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-300">
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="date"
                                                                value={shipDateDisplay}
                                                                onChange={(e) => handleEditResiItem(order.id, itemIdx, 'shipDate', e.target.value)}
                                                                className={`flex-1 px-2 py-1 border rounded text-sm ${shipDateEdit ? 'border-yellow-500 bg-yellow-100' : 'border-slate-300'}`}
                                                            />
                                                            {isShipDateEdited && <span className="inline-block bg-red-500 text-white text-[8px] font-black px-1 py-0.5 rounded flex-shrink-0">ed</span>}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 border-r border-slate-300">
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="text"
                                                                value={catatanEdit || ''}
                                                                onChange={(e) => handleEditResiItem(order.id, itemIdx, 'catatan', e.target.value)}
                                                                className={`flex-1 px-2 py-1 border rounded text-sm ${isCatatanEdited ? 'border-yellow-500 bg-yellow-100' : 'border-slate-300'}`}
                                                                placeholder="Ketik catatan..."
                                                            />
                                                            {isCatatanEdited && <span className="inline-block bg-blue-500 text-white text-[8px] font-black px-1 py-0.5 rounded flex-shrink-0">ed</span>}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-center font-bold text-slate-800">{item.qty} pcs</td>
                                                </tr>
                                            );
                                        })
                                    )}
                            </tbody>
                        </table>
                    </div>

                    {/* TOMBOL AKSI */}
                    <div className="flex gap-3 items-center justify-center flex-wrap">
                        <button onClick={handleRekapSekarang} disabled={isLoadingLocal} className="flex-1 md:flex-none px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-black rounded-xl shadow-lg transition-transform transform hover:-translate-y-1">
                            <i className="fa-solid fa-chart-pie mr-2"></i> {isLoadingLocal ? 'MEMPROSES...' : 'REKAP SEKARANG'}
                        </button>
                        <button onClick={() => window.location.reload()} className="flex-1 md:flex-none px-6 py-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black rounded-xl shadow-md transition-colors">
                            <i className="fa-solid fa-arrow-rotate-left mr-2"></i> MULAI ULANG
                        </button>
                    </div>
                </div>
            )}

            {analysisResult && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200">
                        {/* KEMBALI KE DESAIN TAB YANG LAMA (Besar, Icon di Atas) */}
                        <div className="flex overflow-x-auto bg-slate-100 p-2 gap-2 border-b-4 border-slate-200 no-print custom-scrollbar">
                            <button onClick={() => setActiveTab('PO')} className={`flex-1 flex flex-col items-center py-4 px-6 rounded-2xl transition-colors font-black text-sm whitespace-nowrap ${activeTab === 'PO' ? 'bg-rose-600 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                                <i className="fa-solid fa-triangle-exclamation text-2xl mb-1"></i> Pesan Bengkel (Online) <span className="mt-1 bg-white/20 px-3 rounded-full">{analysisResult.poList.reduce((a, c) => a + c.missingQty, 0)} Pcs</span>
                            </button>
                            <button onClick={() => setActiveTab('READY')} className={`flex-1 flex flex-col items-center py-4 px-6 rounded-2xl transition-colors font-black text-sm whitespace-nowrap ${activeTab === 'READY' ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                                <i className="fa-solid fa-check-double text-2xl mb-1"></i> Barang Ready <span className="mt-1 bg-white/20 px-3 rounded-full">{analysisResult.readyList.reduce((a, c) => a + c.qty, 0)} Pcs</span>
                            </button>
                            <button onClick={() => setActiveTab('UNREC')} className={`flex-1 flex flex-col items-center py-4 px-6 rounded-2xl transition-colors font-black text-sm whitespace-nowrap ${activeTab === 'UNREC' ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                                <i className="fa-solid fa-circle-question text-2xl mb-1"></i> Tidak Dikenali <span className="mt-1 bg-white/20 px-3 rounded-full">{analysisResult.unrecognizedList.reduce((a, c) => a + c.qty, 0)} Pcs</span>
                            </button>
                        </div>

                        <div className={`p-8 bg-slate-50 ${activeTab !== 'READY' && 'hidden'}`}>
                            <div className="flex flex-col md:flex-row justify-between items-center mb-6 border-b pb-4 border-slate-300 gap-4 no-print">
                                <div><h3 className="text-xl font-black text-emerald-700 flex items-center"><i className="fa-solid fa-clipboard-list mr-2"></i> Daftar Barang Siap Ambil (Untuk Picker)</h3></div>
                                <button onClick={handlePrintPickingList} disabled={analysisResult.readyList.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-xl font-black shadow-md transition-transform transform hover:-translate-y-1">
                                    <i className="fa-solid fa-print mr-2"></i> DOWNLOAD PDF DAFTAR AMBIL
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-h-[500px] overflow-y-auto custom-scrollbar no-print">
                                {analysisResult.readyList.map((item, idx) => (
                                    <div key={idx} className={`bg-white p-4 rounded-xl flex items-center gap-4 ${item.isEdited ? 'border-2 border-yellow-400 bg-yellow-50 shadow-md shadow-yellow-300' : 'border border-emerald-200'}`}>
                                        <div className={`${item.isEdited ? 'bg-yellow-200 text-yellow-800' : 'bg-emerald-100 text-emerald-700'} w-12 h-12 rounded-lg flex items-center justify-center font-black text-xl`}>{item.qty}</div>
                                        <div className="flex-1">
                                            <div className="font-black text-slate-800 flex items-center gap-2 flex-wrap">{item.variant.article} {item.isEdited && <span className="inline-block bg-yellow-400 text-yellow-900 text-xs font-black px-2 py-0.5 rounded">ed</span>}</div>
                                            <div className="text-xs font-bold text-slate-500">{item.variant.colorName} - Sz: <span className="text-orange-500">{item.variant.sizeName}</span></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {/* TEMPLATE PRINT PICKING LIST */}
                            <div id="print-picking-area" className="hidden">
                                <table className="picking-table">
                                    <thead>
                                        <tr>
                                            <th colSpan="4" style={{ fontSize: '16pt', border: '2px solid black' }}>Daftar barang yang ada di stok</th>
                                            <th style={{ border: '2px solid black', borderRight: '1px solid black', verticalAlign: 'middle' }}>tanggal<br />{analysisTime ? analysisTime.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''}</th>
                                            <th style={{ border: '2px solid black', verticalAlign: 'middle' }}>jam<br />{analysisTime ? analysisTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : ''}</th>
                                        </tr>
                                        <tr className="picking-header" style={{ border: '2px solid black', borderTop: 'none' }}>
                                            <th>Article</th>
                                            <th>warna</th>
                                            <th>size</th>
                                            <th>Quantity</th>
                                            <th>kode tahun</th>
                                            <th>keterangan</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.keys(groupedPicking).map(article => {
                                            const items = groupedPicking[article];
                                            return items.map((item, idx) => {
                                                const fifoCodes = getFifoBatches(item.variant.sku, item.qty);
                                                return (
                                                    <tr key={idx}>
                                                        {idx === 0 && <td rowSpan={items.length} style={{ verticalAlign: 'middle', fontWeight: 'bold' }}>{article}</td>}
                                                        <td>{item.variant.colorName}</td>
                                                        <td>{item.variant.sizeName}</td>
                                                        <td style={{ fontWeight: 'bold', fontSize: '13pt' }}>{item.qty}</td>
                                                        <td style={{ fontWeight: 'bold' }}>{fifoCodes}</td>
                                                        <td></td>
                                                    </tr>
                                                );
                                            });
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* KERTAS PO */}
                        <div className={`p-8 bg-slate-50 ${activeTab !== 'PO' && 'hidden'}`}>
                            <div className="flex flex-col md:flex-row justify-between items-center mb-6 no-print border-b pb-4 border-slate-300 gap-4">
                                <h3 className="text-xl font-black text-rose-700 flex items-center"><i className="fa-solid fa-triangle-exclamation mr-2"></i> Daftar Kekurangan (Harus Produksi)</h3>
                                <div className="flex flex-wrap gap-3 w-full md:w-auto items-center justify-end">
                                    <button onClick={handlePrint} disabled={analysisResult.poList.length === 0} className="flex-1 md:flex-none bg-slate-900 hover:bg-slate-800 text-white px-8 py-3.5 rounded-xl font-black shadow-md transition-transform transform hover:-translate-y-1 disabled:opacity-50">
                                        <i className="fa-solid fa-print mr-2 text-lg"></i> CETAK PESANAN KERTAS
                                    </button>
                                </div>
                            </div>

                            {/* BANNER ANTRIAN READY */}
                            <div className={`mb-4 rounded-2xl border-2 p-4 flex flex-col md:flex-row items-center justify-between gap-3 ${readyDrafts.length > 0 ? 'bg-teal-50 border-teal-300' : 'bg-slate-100 border-slate-200'}`}>
                                <div className="flex items-center gap-3">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black ${readyDrafts.length > 0 ? 'bg-teal-500 text-white' : 'bg-slate-300 text-slate-500'}`}>
                                        {readyDrafts.length > 0 ? <i className="fa-solid fa-tags"></i> : <i className="fa-solid fa-inbox"></i>}
                                    </div>
                                    <div>
                                        <div className="font-black text-slate-800">
                                            {readyDrafts.length > 0
                                                ? <><i className="fa-solid fa-tags mr-1"></i>  <span className="text-teal-700">{readyDrafts.length} batch resi READY</span> tersimpan
                                                    (<span className="text-teal-600 font-black">{readyDrafts.reduce((a, d) => a + (d.totalPcs || 0), 0)} pcs total</span>)</>
                                                : 'Antrean Resi Ready kosong'}
                                        </div>
                                        <div className="text-xs text-slate-500 font-bold mt-0.5">
                                            {readyDrafts.length > 0
                                                ? `Tanggal: ${[...new Set(readyDrafts.map(d => d.targetDate))].join(', ')} | Sesi: ${[...new Set(readyDrafts.map(d => d.session).filter(Boolean))].map(s => `SESI ${s}`).join(', ') || '-'}`
                                                : 'Siapkan untuk Tim QC, lalu Resi Ready akan otomatis tersimpan di sini'}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2 flex-wrap justify-end">
                                    {(currentUser?.role === 'admin' || (currentUser?.access || []).includes('delete_antrean')) && (
                                        <button onClick={handleHapusAntrianReady} disabled={readyDrafts.length === 0 || poDraftLoading}
                                            className="bg-rose-50 hover:bg-rose-500 text-rose-600 hover:text-white disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 border border-rose-200 px-4 py-3 rounded-xl font-black shadow-sm transition-colors flex items-center gap-2">
                                            <i className="fa-solid fa-trash-can"></i> Hapus Antrean
                                        </button>
                                    )}

                                    <button onClick={handleCetakResiReadyAntrian} disabled={readyDrafts.length === 0 || poDraftLoading}
                                        className="bg-teal-600 hover:bg-teal-500 disabled:bg-slate-400 text-white px-5 py-3 rounded-xl font-black shadow-md transition-transform transform hover:-translate-y-1 disabled:opacity-50 flex items-center gap-2">
                                        <i className="fa-solid fa-print"></i> Cetak Resi Ready
                                    </button>
                                </div>
                            </div>

                            {/* BANNER ANTRIAN PO - ditampilkan selalu di tab PO */}
                            <div className={`mb-4 rounded-2xl border-2 p-4 flex flex-col md:flex-row items-center justify-between gap-3 ${poDrafts.length > 0 ? 'bg-amber-50 border-amber-300' : 'bg-slate-100 border-slate-200'}`}>
                                <div className="flex items-center gap-3">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black ${poDrafts.length > 0 ? 'bg-amber-400 text-white' : 'bg-slate-300 text-slate-500'}`}>
                                        {poDrafts.length > 0 ? <i className="fa-solid fa-box-open"></i> : <i className="fa-solid fa-inbox"></i>}
                                    </div>
                                    <div>
                                        <div className="font-black text-slate-800">
                                            {poDrafts.length > 0
                                                ? <><i className="fa-solid fa-box-open mr-1"></i>  <span className="text-amber-700">{poDrafts.length} batch</span> tersimpan di antrian
                                                    (<span className="text-rose-600 font-black">{poDrafts.reduce((a, d) => a + d.items.reduce((b, i) => b + i.missingQty, 0), 0)} pcs total</span>)</>
                                                : 'Antrian PO kosong'}
                                        </div>
                                        <div className="text-xs text-slate-500 font-bold mt-0.5">
                                            {poDrafts.length > 0
                                                ? `Tanggal: ${[...new Set(poDrafts.map(d => d.targetDate))].join(', ')} | Sesi: ${[...new Set(poDrafts.map(d => d.session).filter(Boolean))].map(s => `SESI ${s}`).join(', ') || '-'}`
                                                : 'Siapkan untuk Tim QC, lalu PO otomatis tersimpan ke antrian'}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2 flex-wrap justify-end">
                                    {/* TOMBOL HAPUS BARU (Hanya Muncul untuk Admin / Akses Hapus) */}
                                    {(currentUser?.role === 'admin' || (currentUser?.access || []).includes('delete_antrean')) && (
                                        <button onClick={handleHapusAntrianPO} disabled={poDrafts.length === 0 || poDraftLoading}
                                            className="bg-rose-50 hover:bg-rose-500 text-rose-600 hover:text-white disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 border border-rose-200 px-5 py-3 rounded-xl font-black shadow-sm transition-colors flex items-center gap-2">
                                            <i className="fa-solid fa-trash-can"></i> Hapus Antrean
                                        </button>
                                    )}

                                    <button onClick={handleCetakLabelAntrian} disabled={poDrafts.length === 0 || poDraftLoading}
                                        className="bg-orange-500 hover:bg-orange-600 disabled:bg-slate-400 text-white px-5 py-3 rounded-xl font-black shadow-md transition-transform transform hover:-translate-y-1 disabled:opacity-50 flex items-center gap-2">
                                        <i className="fa-solid fa-tags"></i> Cetak Label
                                    </button>
                                    <button onClick={handleKirimProduksi} disabled={poDrafts.length === 0 || poDraftLoading}
                                        className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-400 text-white px-8 py-3 rounded-xl font-black shadow-md transition-transform transform hover:-translate-y-1 disabled:opacity-50 flex items-center gap-2">
                                        {poDraftLoading ? <><i className="fa-solid fa-circle-notch fa-spin"></i> Proses...</> : <><i className="fa-solid fa-paper-plane"></i> Kirim ke Produksi</>}
                                    </button>
                                </div>
                            </div>

                            {analysisResult.poList.length === 0 ? (
                                <div className="text-center py-16 text-emerald-600"><i className="fa-solid fa-face-smile-beam text-6xl mb-4"></i><h2 className="text-2xl font-black">STOK GUDANG AMAN!</h2><p className="font-bold">Semua pesanan ada di rak.</p></div>
                            ) : (
                                <div className="overflow-x-auto flex justify-center bg-white p-6 rounded-2xl border border-slate-200 shadow-inner">
                                    <div id="print-po-area" className="bg-white w-full max-w-[800px]">
                                        <h2 style={{ fontFamily: "'Times New Roman', serif", textAlign: 'center', color: '#dc2626', textTransform: 'uppercase', fontWeight: '900', fontSize: '22pt', margin: '0 0 10px 0' }}>PESANAN ONLINE FARADELA OFFICIAL</h2>
                                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                                            <span style={{
                                                fontFamily: "'Times New Roman', serif", fontStyle: 'italic', fontWeight: 'bold', fontSize: '15pt',
                                                color: '#dc2626', border: '2px solid #dc2626', padding: '5px 20px', display: 'inline-block'
                                            }}>
                                                {new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(poDraftDate))} (SESI {poSession})
                                            </span>
                                        </div>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontFamily: "'Times New Roman', serif", fontSize: '12pt', border: '2px solid black' }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ border: '2px solid black', padding: '10px', backgroundColor: '#e2efda', fontWeight: 'bold' }}>ARTICLE</th>
                                                    <th style={{ border: '2px solid black', padding: '10px', backgroundColor: '#e2efda', fontWeight: 'bold' }}>COLOUR</th>
                                                    <th style={{ border: '2px solid black', padding: '10px', backgroundColor: '#e2efda', fontWeight: 'bold' }}>SIZE</th>
                                                    <th style={{ border: '2px solid black', padding: '10px', backgroundColor: '#e2efda', fontWeight: 'bold' }}>JUMLAH</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {analysisResult.poList.filter(i => !i.variant.article.toUpperCase().startsWith('F07-')).map((item, idx) => (
                                                    <tr key={`main-${idx}`} style={{ color: item.isUrgent ? '#dc2626' : 'black', fontWeight: 'bold', backgroundColor: item.isEdited ? '#fef3c7' : 'transparent' }}>
                                                        <td style={{ border: '1px solid black', padding: '8px' }}>{item.variant.article}{item.isEdited && <span style={{ fontWeight: '900', color: '#ea580c', marginLeft: '4px', fontSize: '10px', backgroundColor: '#fed7aa', padding: '1px 4px', borderRadius: '3px' }}>ed</span>}</td>
                                                        <td style={{ border: '1px solid black', padding: '8px' }}>{item.variant.colorName}</td>
                                                        <td style={{ border: '1px solid black', padding: '8px' }}>{item.variant.sizeName}</td>
                                                        <td style={{ border: '1px solid black', padding: '8px' }}>{item.missingQty}</td>
                                                    </tr>
                                                ))}
                                                {analysisResult.poList.filter(i => !i.variant.article.toUpperCase().startsWith('F07-')).length > 0 && (
                                                    <tr style={{ fontWeight: 'bold', backgroundColor: '#f8fafc' }}>
                                                        <td colSpan="3" style={{ border: '2px solid black', padding: '12px', textAlign: 'center', textTransform: 'uppercase', color: 'black' }}>JUMLAH</td>
                                                        <td style={{ border: '2px solid black', padding: '12px', color: '#dc2626' }}>{analysisResult.poList.filter(i => !i.variant.article.toUpperCase().startsWith('F07-')).reduce((a, c) => a + c.missingQty, 0)}</td>
                                                    </tr>
                                                )}

                                                {/* Tabel Khusus F07 dipisah visualnya */}
                                                {analysisResult.poList.some(i => i.variant.article.toUpperCase().startsWith('F07-')) && (
                                                    <>
                                                        <tr>
                                                            <td colSpan="4" style={{ backgroundColor: '#slate-300', padding: '15px 0' }}></td>
                                                        </tr>
                                                        <tr>
                                                            <td colSpan="4" style={{ backgroundColor: '#fee2e2', border: '2px solid black', padding: '10px', fontWeight: '900', color: '#b91c1c' }}>BENGKEL KHUSUS (F07)</td>
                                                        </tr>
                                                        {analysisResult.poList.filter(i => i.variant.article.toUpperCase().startsWith('F07-')).map((item, idx) => {
                                                            const shortArt = item.variant.article.substring(4).replace(/^0+/, '').replace(/\.\d+$/, '');
                                                            return (
                                                                <tr key={`f07-${idx}`} style={{ color: item.isUrgent ? '#dc2626' : 'black', fontWeight: 'bold', backgroundColor: item.isEdited ? '#fef3c7' : 'transparent' }}>
                                                                    <td style={{ border: '1px solid black', padding: '8px' }}>{shortArt}{item.isEdited && <span style={{ fontWeight: '900', color: '#ea580c', marginLeft: '4px', fontSize: '10px', backgroundColor: '#fed7aa', padding: '1px 4px', borderRadius: '3px' }}>ed</span>}</td>
                                                                    <td style={{ border: '1px solid black', padding: '8px' }}>{item.variant.colorName}</td>
                                                                    <td style={{ border: '1px solid black', padding: '8px' }}>{item.variant.sizeName}</td>
                                                                    <td style={{ border: '1px solid black', padding: '8px' }}>{item.missingQty}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                        <tr style={{ fontWeight: 'bold', backgroundColor: '#fef2f2' }}>
                                                            <td colSpan="3" style={{ border: '2px solid black', padding: '12px', textAlign: 'center', textTransform: 'uppercase', color: 'black' }}>TOTAL F07</td>
                                                            <td style={{ border: '2px solid black', padding: '12px', color: '#dc2626' }}>{analysisResult.poList.filter(i => i.variant.article.toUpperCase().startsWith('F07-')).reduce((a, c) => a + c.missingQty, 0)}</td>
                                                        </tr>
                                                    </>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* TAB TIDAK DIKENALI */}
                        <div className={`p-8 bg-slate-50 ${activeTab !== 'UNREC' && 'hidden'}`}>
                            <div className="mb-6 border-b pb-4 border-slate-300 no-print">
                                <h3 className="text-xl font-black text-slate-800 flex items-center"><i className="fa-solid fa-circle-question mr-2"></i> SKU Tidak Dikenali</h3>
                                <p className="text-sm text-slate-500 font-semibold mt-1">Teks SKU di bawah ini <b className="text-rose-500">TIDAK ADA</b> di Master Produk Anda (Mungkin salah ketik di marketplace).</p>
                            </div>
                            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                {analysisResult.unrecognizedList.map((item, idx) => (
                                    <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center gap-3">
                                        <div className="font-mono text-sm font-bold text-slate-700">{item.sku}</div>
                                        <div className="flex items-center gap-2">
                                            {item.sku.split('-').length < 3 && (
                                                <span className="text-xs text-amber-600 font-bold">(⚠️ SKU tidak lengkap)</span>
                                            )}
                                            <div className="bg-slate-100 px-3 py-1 rounded-lg font-bold text-slate-600 text-sm whitespace-nowrap">Butuh: {item.qty}</div>
                                        </div>
                                    </div>
                                ))}
                                {analysisResult.unrecognizedList.length === 0 && <div className="text-center py-10 text-slate-400 font-bold">Hebat! Semua data sinkron dengan aplikasi Anda.</div>}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* RIWAYAT PESANAN ONLINE (SPO) - MIRIP MPO */}
            <div className="mt-8 bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden no-print animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-black text-xl text-slate-800 uppercase tracking-widest"><i className="fa-solid fa-clock-rotate-left text-emerald-600 mr-3"></i> Daftar Riwayat Pesanan</h3>
                    <span className={`font-bold px-4 py-1.5 rounded-full text-xs shadow-inner uppercase tracking-wider ${onlineHistory.length > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500'}`}>{onlineHistory.length} Batch Tersimpan</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-100 text-slate-700 text-[10px] border-b-4 border-slate-200">
                            <tr>
                                <th className="p-6 font-black uppercase tracking-tighter w-48">SESI & TANGGAL</th>
                                <th className="p-6 font-black uppercase tracking-tighter w-48">INFO BATCH</th>
                                <th className="p-6 font-black text-center uppercase tracking-tighter">AKSI RESI EKSPEDISI</th>
                                <th className="p-6 font-black text-center uppercase tracking-tighter">AKSI DOKUMEN PRODUKSI</th>
                                <th className="p-6 font-black text-right uppercase tracking-tighter w-24">SET</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {onlineHistory.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-12 text-center text-slate-400">
                                        <i className="fa-solid fa-folder-open text-5xl mb-4 block text-slate-200"></i>
                                        <p className="font-black text-slate-500 text-lg">BELUM ADA RIWAYAT PESANAN</p>
                                        <p className="text-sm font-bold mt-2">Kirim antrean PO ke produksi untuk menyimpan riwayat di sini.</p>
                                    </td>
                                </tr>
                            ) : (
                                onlineHistory.map(batch => {
                                    const totalPcs = (batch.items || []).reduce((acc, curr) => acc + (curr.missingQty || 0), 0);
                                    const totalSku = new Set((batch.items || []).map(i => i.article)).size;
                                    const dateDisplay = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(batch.targetDate));

                                    return (
                                        <tr key={batch.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-6">
                                                <div className="font-black text-xl text-slate-900 leading-none">SESI {batch.session}</div>
                                                <div className="text-xs font-bold text-slate-400 mt-2 flex items-center gap-1.5"><i className="fa-regular fa-calendar-check text-emerald-500"></i> {dateDisplay}</div>
                                            </td>
                                            <td className="p-6">
                                                <div className="flex items-center gap-3 mt-2">
                                                    <div className="text-3xl font-black text-blue-600 leading-none">
                                                        {batch.totalResiAll || '-'} <span className="text-[11px] text-slate-400 uppercase font-bold tracking-widest">Resi</span>
                                                    </div>
                                                    <div className="text-3xl font-black text-slate-200 leading-none">/</div>
                                                    <div className="text-3xl font-black text-rose-600 leading-none">
                                                        {batch.totalPcsAll || '-'} <span className="text-[11px] text-slate-400 uppercase font-bold tracking-widest">Pcs</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-6 text-center border-l border-slate-100">
                                                <div className="flex items-center justify-center gap-2 flex-col sm:flex-row">
                                                    <button type="button" title="Cetak Semua Resi (Ready + PO)" onClick={() => handleRePrintResi(batch, 'all')} className="flex-1 w-full sm:w-auto px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white shadow-sm transition-all text-[11px] font-black uppercase">
                                                        <i className="fa-solid fa-print mr-1"></i> SEMUA
                                                    </button>
                                                    <button type="button" title="Cetak Resi Barang Ready Saja" onClick={() => handleRePrintResi(batch, 'ready')} className="flex-1 w-full sm:w-auto px-4 py-2.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-600 hover:text-white shadow-sm transition-all text-[11px] font-black uppercase">
                                                        <i className="fa-solid fa-box-open mr-1"></i> READY
                                                    </button>
                                                    <button type="button" title="Cetak Resi Ready Terakhir (Sesi Ini)" onClick={() => handleRePrintResi(batch, 'ready_latest')} className="flex-1 w-full sm:w-auto px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white shadow-sm transition-all text-[11px] font-black uppercase tracking-tighter">
                                                        <i className="fa-solid fa-bolt mr-1"></i> LATEST
                                                    </button>
                                                    <button type="button" title="Cetak Resi Pesanan Online Saja" onClick={() => handleRePrintResi(batch, 'po')} className="flex-1 w-full sm:w-auto px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white shadow-sm transition-all text-[11px] font-black uppercase">
                                                        <i className="fa-solid fa-clock mr-1"></i> PO
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="p-6 text-center border-l border-slate-100">
                                                <div className="flex items-center justify-center gap-2 flex-col sm:flex-row">
                                                    <button type="button" onClick={() => handleRePrintSPO(batch)} className="flex-1 w-full sm:w-auto px-4 py-3 rounded-xl border-2 border-emerald-100 bg-white text-emerald-700 hover:bg-emerald-600 hover:text-white shadow-sm transition-all text-[11px] font-black uppercase tracking-tighter group">
                                                        <i className="fa-solid fa-file-invoice mr-1.5 group-hover:scale-125 transition-transform"></i> SPO
                                                    </button>
                                                    <button type="button" title="Cetak Label Produk (Berurutan)" onClick={() => handleRePrintLabels(batch)} className="flex-1 w-full sm:w-auto px-4 py-3 rounded-xl border-2 border-orange-100 bg-white text-orange-700 hover:bg-orange-600 hover:text-white shadow-sm transition-all text-[11px] font-black uppercase tracking-tighter group">
                                                        <i className="fa-solid fa-tags mr-1.5 group-hover:rotate-12 transition-transform"></i> LBL
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="p-6 text-right">
                                                <button type="button" onClick={() => handleDeleteHistory(batch.id)} className="w-10 h-10 bg-white border border-rose-100 shadow-sm rounded-xl hover:bg-rose-500 hover:text-white text-rose-500 transition-all">
                                                    <i className="fa-solid fa-trash-can"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// NEW: MENU QC & PACKING (Audio-First & Break Feature)
// NEW: MENU QC & PACKING (Audio-First & Break Feature)
// NEW: MENU QC & PACKING (Zero Touch - Auto Switch & Double Resi Defect Trigger)
// NEW: MENU QC & PACKING (Zero Touch - Smart Voice & Hybrid PO Logic)
// FIX: MENU QC & PACKING (Zero Touch - Perbaikan Logika Barang Rusak & Suara Pintar)
const MOTIVASI_QC = [
    'Semangat Bekerja! ',
];

function QcPacking({ variants, qcOrders, setIsLoading, showToast }) {
    const [currentResi, setCurrentResi] = useState('');
    const [activeOrder, setActiveOrder] = useState(null);
    const [isDefectMode, setIsDefectMode] = useState(false);
    const [activeCart, setActiveCart] = useState(''); // NEW STATE
    const [cartInput, setCartInput] = useState(''); // FOR INPUT
    const [isDone, setIsDone] = useState(false);
    const [activeEmployee, setActiveEmployee] = useState(null); // NEW: employee lookup
    const [motivasiMsg, setMotivasiMsg] = useState('');
    const inputRef = useRef(null);
    const cartInputRef = useRef(null);

    const pendingOrders = qcOrders.filter(o => o.status === 'PENDING' || o.status === 'TRANSIT');

    const handleCartSubmit = async (e) => {
        e.preventDefault();
        if (!cartInput.trim()) return;
        const idVal = cartInput.trim().toUpperCase();
        setCartInput('');

        // Wajib validasi: hanya ID karyawan terdaftar yang bisa masuk
        try {
            const snap = await db.collection('employees').where('idKaryawan', '==', idVal).limit(1).get();
            if (!snap.empty) {
                const emp = snap.docs[0].data();
                setActiveEmployee(emp);
                const msg = MOTIVASI_QC[Math.floor(Math.random() * MOTIVASI_QC.length)];
                setMotivasiMsg(msg);
                playCekling();
                showToast('success', `✅ Selamat datang, ${emp.nama}! ${msg}`);
                setActiveCart(idVal);
            } else {
                // Bukan ID karyawan yang dikenal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ tolak (termasuk jika scan resi)
                playError();
                playTTS('ID tidak dikenali, scan ID Card karyawan');
                showToast('error', 'ID tidak ditemukan! Harap scan ID Card karyawan yang terdaftar.');
            }
        } catch (err) {
            playError();
            showToast('error', 'Gagal memverifikasi ID: ' + err.message);
        }
    }

    const handleSelesaiQC = async () => {
        if (!activeCart) return;
        if (confirm('Tutup keranjang/karung ini dan selesai QC hari ini? Paket bisa di-handover ke Kurir.')) {
            setIsLoading(true);
            try {
                const batch = db.batch();
                let hasUpdate = false;
                // Gunakan cartClosed !== true agar menangkap order yg belum punya field cartClosed (undefined)
                qcOrders.filter(o => o.cartId === activeCart && o.cartClosed !== true).forEach(o => {
                    batch.update(db.collection('qc_orders').doc(o.id), { cartClosed: true });
                    hasUpdate = true;
                });
                if (hasUpdate) await batch.commit();
                setActiveCart('');
                setIsDefectMode(false);
                setActiveOrder(null);
                setIsDone(false);
                setActiveEmployee(null);
                setMotivasiMsg('');
                showToast('success', 'Selesai QC! Paket siap diserahkan ke Kurir. ✅');
            } catch (e) { showToast('error', e.message); }
            setIsLoading(false);
        }
    };

    const handleIstirahatQC = async () => {
        if (!activeCart) return;
        if (confirm('Istirahat sejenak? Keranjang tetap terbuka, bisa dilanjutkan nanti.')) {
            setActiveCart('');
            setIsDefectMode(false);
            setActiveOrder(null);
            setIsDone(false);
            setActiveEmployee(null);
            setMotivasiMsg('');
            showToast('success', 'Istirahat dulu ya! Jangan lupa balik lagi. 💤');
        }
    }

    const handleScan = (e) => {
        e.preventDefault();
        if (!activeCart) return;
        // if (isBreak) return; // Removed as activeCart now controls the "working" state

        const scannedVal = currentResi.trim().toUpperCase();
        if (!scannedVal) return;
        setCurrentResi('');

        // 1. CEK APAKAH YANG DI-SCAN ADALAH RESI
        const orderFound = qcOrders.find(o => o.id.toUpperCase() === scannedVal);

        if (orderFound && orderFound.status === 'SHIPPED') {
            playError();
            playTTS('Pesanan sudah di kurir');
            showToast('error', 'Pesanan ini sudah berstatus SHIPPED (di Kurir)!');
            return;
        }

        if (orderFound) {
            // KONDISI A: Scan resi yang SAMA dengan yang aktif (Pemicu Koreksi Rusak)
            if (activeOrder && activeOrder.id.toUpperCase() === scannedVal) {
                setIsDefectMode(true);
                setIsDone(false); // Buka kunci jika sebelumnya sudah selesai
                playTTS('scan barang yang rusak');
                showToast('warning', 'MODE KOREKSI RUSAK AKTIF!');
                return;
            }

            // KONDISI B: Scan resi BARU atau resi LAIN (Auto-Switch)
            setActiveOrder(orderFound);
            setIsDefectMode(false);
            setIsDone(orderFound.status === 'PACKED' || orderFound.status === 'SHIPPED');
            playSuccess();
            // Ucapkan total qty pesanan saat resi dibuka
            const totalQty = orderFound.items.reduce((a, b) => a + b.qty, 0);
            const totalScanned = orderFound.items.reduce((a, b) => a + (b.scanned || 0), 0);
            const sisaQty = totalQty - totalScanned;
            if (orderFound.status === 'PACKED' || orderFound.status === 'SHIPPED') {
                playTTS('Pesanan sudah lengkap');
            } else if (totalScanned > 0) {
                playTTS(`Lanjut, sisa ${sisaQty} lagi`);
            } else {
                playTTS(`${totalQty} pesanan`);
            }
            return;
        }

        // 2. CEK APAKAH YANG DI-SCAN ADALAH PRODUK
        if (!activeOrder) {
            playError();
            playTTS('Scan resi dulu');
            return;
        }

        if (isDone) {
            playError();
            playTTS('Pesanan sudah pas, silakan packing');
            return;
        }

        let skuCandidate = scannedVal;

        // JIKA BARCODE BARU (Mulai dengan $)
        if (skuCandidate.startsWith('$')) {
            skuCandidate = parseGlobalSku(skuCandidate);
        } else {
            // LOGIKA LAMA
            if (skuCandidate.includes('#')) skuCandidate = skuCandidate.split('#')[0];
            if (skuCandidate.includes('*')) skuCandidate = skuCandidate.split('*')[0];
            if (skuCandidate.length > 8 && !isNaN(skuCandidate.slice(-8))) {
                skuCandidate = skuCandidate.slice(0, -8);
            }
        }

        const itemIndex = activeOrder.items.findIndex(i => i.sysSku === skuCandidate || i.sku === skuCandidate);

        if (itemIndex === -1) {
            playError();
            playTTS('Barang tidak sesuai pesanan');
            setIsDefectMode(false);
            return;
        }

        // CLONE DATA SECARA MENDALAM (DEEP COPY) UNTUK MENGHINDARI BUG STATE
        const newOrder = {
            ...activeOrder,
            items: activeOrder.items.map(item => ({ ...item }))
        };
        const item = newOrder.items[itemIndex];

        // LOGIKA MODE RUSAK (AKTIF SETELAH SCAN RESI 2X)
        if (isDefectMode) {
            if (item.scanned > 0) {
                item.scanned -= 1;
                item.defect = (item.defect || 0) + 1;
                newOrder.status = 'PENDING'; // Turunkan status jika ada kerusakan
                setActiveOrder(newOrder);
                saveOrderProgress(newOrder);
                playTTS('oke, rijek');
            } else {
                playTTS('Gagal, barang belum ada yang di scan masuk');
            }
            setIsDefectMode(false);
            setIsDone(false);
            return;
        }

        // LOGIKA SCAN NORMAL
        // Jika item sudah penuh, tolak scan tambahan
        if (item.scanned >= item.qty) {
            playError();
            playTTS('Jumlah sudah pas');
            return;
        }

        // Jika item berstatus PO tapi ternyata bisa di-scan (stok sudah ada)
        // -> Ubah statusnya langsung jadi READY agar bisa dihitung normal
        if (item.status === 'PO') {
            item.status = 'READY';
        }

        item.scanned += 1;

        // Hitung sisa setelah scan ini
        const totalMissingReady = newOrder.items.filter(i => i.status === 'READY' && i.scanned < i.qty).reduce((a, b) => a + (b.qty - b.scanned), 0);
        // Item PO yang belum bisa di-scan (masih murni PO, belum ada fisiknya)
        const totalMissingPO = newOrder.items.filter(i => i.status === 'PO' && i.scanned < i.qty).reduce((a, b) => a + (b.qty - b.scanned), 0);

        setActiveOrder(newOrder);

        const isTotallyComplete = newOrder.items.every(i => i.scanned >= i.qty);

        if (isTotallyComplete) {
            newOrder.status = 'PACKED';
            saveOrderProgress(newOrder);
            setIsDone(true);
            playCekling();
            playTTS('PAS');
        } else {
            // VOICE FEEDBACK BERTAHAP:
            // 1. Jika masih ada READY yang kurang -> sebut sisa ready
            // 2. Jika ready sudah habis tapi ada PO -> sebut sisa PO
            // 3. Jika tidak ada sisa apapun selain yg sudah di-scan -> selesai normal
            if (totalMissingReady > 0) {
                playTTS(`${item.scanned} oke, ${totalMissingReady} lagi`);
            } else if (totalMissingPO > 0) {
                playTTS(`${item.scanned} oke, ${totalMissingPO} lagi ada di Bengkel`);
            } else {
                playTTS(`${item.scanned} oke`);
            }
            saveOrderProgress(newOrder);
        }
    };

    const saveOrderProgress = (orderObj) => {
        const dataToSave = { ...orderObj };
        if (activeCart) {
            dataToSave.cartId = activeCart;
            dataToSave.cartClosed = false;
        }
        db.collection('qc_orders').doc(dataToSave.id).set(dataToSave, { merge: true });
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {!activeCart ? (
                <div className="bg-white p-16 rounded-3xl border border-slate-200 shadow-2xl text-center">
                    <i className="fa-solid fa-id-card text-8xl text-orange-500 mb-8 mt-4 animate-bounce"></i>
                    <h2 className="text-4xl font-black text-slate-800 mb-4">SCAN ID CHART KAMU</h2>
                    <p className="text-slate-500 font-bold mb-8 text-lg">Silakan scan Barcode ID Chart/Keranjang Anda sebelum memulai QC.</p>
                    <form onSubmit={handleCartSubmit}>
                        <input ref={cartInputRef} autoFocus value={cartInput} onChange={e => setCartInput(e.target.value)} className="w-full max-w-xl p-6 text-3xl font-mono text-center border-4 border-orange-200 focus:border-orange-600 rounded-2xl outline-none shadow-inner bg-slate-50" placeholder="SCAN ID CHART..." />
                    </form>
                </div>
            ) : !activeOrder ? (
                <div className="bg-white p-10 rounded-3xl border-2 border-slate-200 shadow-2xl text-center relative overflow-hidden min-h-[480px]">
                    {/* TOMBOL SELESAI QC SAJA (tanpa istirahat) */}
                    <div className="absolute z-10 top-6 right-6 flex gap-2">
                        <button onClick={handleSelesaiQC} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-black py-3 px-5 rounded-xl flex items-center gap-2 transition-colors border-2 border-emerald-300 shadow-sm">
                            <i className="fa-solid fa-circle-check"></i> SELESAI QC
                        </button>
                    </div>

                    <div className="absolute top-6 left-6 flex items-center gap-2 bg-orange-100 text-blue-800 px-4 py-2 rounded-xl font-bold border border-orange-200 shadow-sm transition-colors">
                        <i className="fa-solid fa-cart-shopping"></i> Chart: {activeCart}
                    </div>

                    <div className="mt-8 animate-in fade-in zoom-in duration-300">
                        {/* FOTO KARYAWAN + UCAPAN SEMANGAT */}
                        {activeEmployee ? (
                            <div className="flex flex-col items-center mb-6">
                                <div className="w-24 h-28 rounded-2xl border-4 border-orange-200 overflow-hidden bg-slate-100 shadow-lg mb-3">
                                    {activeEmployee.foto
                                        ? <img src={activeEmployee.foto} className="w-full h-full object-cover" />
                                        : <div className="w-full h-full flex items-center justify-center text-slate-300 text-4xl"><i className="fa-solid fa-user"></i></div>
                                    }
                                </div>
                                <h2 className="text-3xl font-black text-slate-800 mb-1">{activeEmployee.nama}</h2>
                                <span className="bg-orange-100 text-orange-600 text-xs font-black uppercase px-3 py-1 rounded-full mb-3">{activeEmployee.posisi}</span>
                            </div>
                        ) : (
                            <div className="mb-6">
                                <i className="fa-solid fa-barcode text-6xl text-orange-500 mb-4 animate-pulse block"></i>
                                <h2 className="text-4xl font-black text-slate-800 mb-2">TIM QC</h2>
                            </div>
                        )}
                        <p className="text-slate-400 font-bold mb-4 uppercase tracking-widest text-xs">Siap Menerima Scan Resi</p>

                        {/* STATS ANTREAN */}
                        <div className="flex justify-center gap-4 mb-6">
                            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl px-6 py-4 text-center shadow-sm min-w-[140px]">
                                <div className="text-3xl font-black text-amber-600">{pendingOrders.length}</div>
                                <div className="text-xs font-black text-amber-700 uppercase tracking-wide mt-1"><i className="fa-solid fa-clock-rotate-left mr-1"></i>Antrean QC</div>
                            </div>
                            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl px-6 py-4 text-center shadow-sm min-w-[140px]">
                                <div className="text-3xl font-black text-emerald-600">{qcOrders.filter(o => o.status === 'PACKED' && o.cartId === activeCart).length}</div>
                                <div className="text-xs font-black text-emerald-700 uppercase tracking-wide mt-1"><i className="fa-solid fa-box-open mr-1"></i>Selesai QC</div>
                            </div>
                        </div>

                        <form onSubmit={handleScan}>
                            <input ref={inputRef} autoFocus value={currentResi} onChange={e => setCurrentResi(e.target.value)} className="scan-input-big w-full max-w-xl p-5 text-2xl md:text-3xl font-mono text-center border-4 border-orange-200 focus:border-orange-200 rounded-2xl outline-none shadow-inner bg-slate-50" placeholder="SIAP SCAN..." />
                        </form>
                    </div>
                </div>
            ) : (
                <div className={`p-4 md:p-6 rounded-2xl border-4 shadow-xl transition-all duration-300 ${isDefectMode ? 'bg-red-50 border-red-500 shadow-red-100' : 'bg-white border-indigo-500 shadow-indigo-100'}`}>
                    <div className="flex justify-between items-start mb-6 border-b pb-6 border-slate-100">
                        <div>
                            <h3 className="text-3xl font-black flex items-center gap-3">
                                {isDefectMode ? <i className="fa-solid fa-triangle-exclamation text-rose-600 animate-bounce"></i> : <i className="fa-solid fa-box-open text-orange-500"></i>}
                                {activeOrder.id}
                            </h3>
                            <div className="flex gap-3 mt-2">
                                <span className={`px-4 py-1.5 rounded-xl font-black text-xs uppercase shadow-sm border ${activeOrder.platform === 'SHOPEE' ? 'bg-orange-100 text-orange-700 border-orange-200' : activeOrder.platform === 'TIKTOK' ? 'bg-slate-800 text-white border-slate-900' : 'bg-orange-100 text-orange-600 border-orange-200'}`}>{activeOrder.platform}</span>
                                {isDefectMode && <span className="bg-rose-600 text-white px-4 py-1.5 rounded-xl font-black text-xs uppercase animate-pulse shadow-md">Mode Koreksi Rusak Aktif</span>}
                            </div>
                        </div>
                        <button onClick={() => { setIsDefectMode(false); setActiveOrder(null); setIsDone(false); }} className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 p-3 rounded-xl font-black text-xs uppercase transition-colors border border-transparent hover:border-rose-200">Ganti Resi</button>
                    </div>

                    <div className="mb-8">
                        <form onSubmit={handleScan}>
                            <input ref={inputRef} autoFocus value={currentResi} onChange={e => setCurrentResi(e.target.value)} className={`scan-input-big w-full p-4 md:p-6 text-xl md:text-3xl font-mono text-center border-4 rounded-2xl outline-none shadow-inner transition-all ${isDefectMode ? 'border-red-500 bg-red-50 text-red-900 placeholder-red-400' : 'border-slate-300 focus:border-orange-200 bg-slate-50 text-slate-800'}`} placeholder={isDone ? 'PESANAN SELESAI' : isDefectMode ? 'SCAN BARANG RUSAK!' : 'SCAN BARANG...'} />
                        </form>
                    </div>

                    <div className="space-y-4">
                        {activeOrder.items.map((item, idx) => {
                            const variant = variants.find(v => v.sku === item.sysSku || v.sku === item.sku);
                            const itemDone = item.scanned >= item.qty;
                            return (
                                <div key={idx} className={`p-3 md:p-4 rounded-xl border-2 flex items-center justify-between transition-all duration-300 ${itemDone ? 'bg-teal-50 border-teal-400 shadow-sm' : 'bg-slate-50 border-slate-200'}`}>
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center text-xl md:text-2xl shadow-sm flex-shrink-0 ${itemDone ? 'bg-teal-600 text-white' : 'bg-white border-2 border-slate-200 text-slate-300'}`}>
                                            {itemDone ? <i className="fa-solid fa-check"></i> : idx + 1}
                                        </div>
                                        {variant && <img src={variant.photo} className="w-14 h-14 md:w-16 md:h-16 rounded-xl object-cover shadow-md border-2 border-white flex-shrink-0" />}
                                        <div className="min-w-0">
                                            <div className={`font-black text-base md:text-xl truncate ${itemDone ? 'text-teal-900' : 'text-slate-800'}`}>{variant ? variant.article : item.sku}</div>
                                            <div className="text-xs font-bold text-slate-500 uppercase">{variant ? `${variant.colorName} • Sz ${variant.sizeName}` : ''}</div>
                                            <div className="flex gap-1.5 mt-1 flex-wrap">
                                                {item.defect > 0 && <span className="bg-red-700 text-white text-[10px] px-2 py-0.5 rounded-full font-black uppercase"><i className="fa-solid fa-circle-xmark mr-1"></i>Rusak: {item.defect}</span>}
                                                {item.status === 'PO' && !itemDone && <span className="bg-amber-600 text-white text-[10px] px-2 py-0.5 rounded-full font-black uppercase">Tunggu PO</span>}
                                                {item.status === 'PO' && itemDone && <span className="bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black uppercase">PO Selesai</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className={`text-3xl md:text-4xl font-black flex-shrink-0 ml-2 ${itemDone ? 'text-teal-600' : 'text-slate-300'}`}>{item.scanned}<span className="text-base text-slate-300 mx-0.5">/</span>{item.qty}</div>
                                </div>
                            )
                        })}
                    </div>

                    {isDone && (
                        <div className="mt-8 animate-in slide-in-from-bottom-6 duration-500 text-center">
                            <div className="inline-block bg-teal-100 text-teal-700 px-5 py-2 rounded-full font-black text-sm uppercase tracking-widest border border-teal-200 shadow-sm animate-pulse mb-5">
                                <i className="fa-solid fa-wand-magic-sparkles mr-2"></i> Pesanan Siap Dibungkus!
                            </div>
                            <button onClick={() => { setIsDefectMode(false); setActiveOrder(null); setIsDone(false); }} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black py-5 md:py-6 rounded-2xl shadow-xl shadow-slate-800/30 transition-all transform hover:-translate-y-1 text-xl md:text-2xl flex items-center justify-center gap-3 border-b-4 border-slate-950">
                                <i className="fa-solid fa-box"></i> LANJUT PESANAN BARU
                            </button>
                            <p className="text-center text-slate-400 font-bold mt-4 text-sm italic">Tips: Langsung scan Resi baru untuk lanjut otomatis tanpa klik.</p>
                            <p className="text-center text-slate-500 font-bold mt-1 text-xs">Setelah semua selesai, klik <b className="text-emerald-600">SELESAI QC</b> di pojok kanan atas.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// NEW: MENU REVISI STOK (Tim Picker)
function RevisiStok({ variants, transactions, setIsLoading, showToast, currentUser }) {
    const [wrongBarcode, setWrongBarcode] = useState('');
    const [rightBarcode, setRightBarcode] = useState('');
    const inputWrong = useRef(null);
    const inputRight = useRef(null);

    // TAMBAHAN KAMERA
    const [showCamera, setShowCamera] = useState(false);
    const [cameraTarget, setCameraTarget] = useState(null);
    const lastScanRef = useRef({ text: '', time: 0 });

    useEffect(() => {
        let scanner = null;
        if (showCamera) {
            const initScanner = () => {
                if (!window.Html5QrcodeScanner) return;
                scanner = new window.Html5QrcodeScanner('reader-revisi', { fps: 10, qrbox: { width: 250, height: 250 } }, false);
                scanner.render((text) => {
                    const now = Date.now();
                    if (lastScanRef.current.text === text && now - lastScanRef.current.time < 2000) return;
                    lastScanRef.current = { text, time: now };

                    playCekling();
                    if (cameraTarget === 'wrong') {
                        setWrongBarcode(text);
                        setShowCamera(false);
                        if (inputRight.current) setTimeout(() => inputRight.current.focus(), 500);
                    } else if (cameraTarget === 'right') {
                        setRightBarcode(text);
                        setShowCamera(false);
                    }
                }, (err) => { });
            };
            if (!window.Html5QrcodeScanner) {
                const script = document.createElement('script'); script.src = 'https://unpkg.com/html5-qrcode'; script.onload = initScanner; document.head.appendChild(script);
            } else initScanner();
        }
        return () => { if (scanner) scanner.clear().catch(e => console.log(e)); };
    }, [showCamera, cameraTarget]);

    const getVariantByFullBarcode = (barcode) => {
        if (!barcode) return null;
        const clean = barcode.trim().toUpperCase();
        if (clean.startsWith('$')) {
            const sc = clean.substring(1, 5);
            return variants.find(v => v.shortCode === sc);
        } else {
            const sku = parseGlobalSku(clean, variants);
            return variants.find(v => v.sku === sku);
        }
    };

    const handleSwap = async (e) => {
        e.preventDefault();
        const wVar = getVariantByFullBarcode(wrongBarcode.toUpperCase());
        const rVar = getVariantByFullBarcode(rightBarcode.toUpperCase());

        if (!wVar) return showToast('error', 'Barcode Barang yang Dikembalikan TIDAK VALID.');
        if (!rVar) return showToast('error', 'Barcode Barang Baru TIDAK VALID.');

        if (!confirm(`Tukar Barang?\nKembali: ${wVar.article} (${wVar.colorName})\nAmbil Baru: ${rVar.article} (${rVar.colorName})`)) return;

        setIsLoading(true);
        try {
            const batch = window.db.batch();
            const batchId = 'REV' + Date.now();
            const operatorName = currentUser.nama || currentUser.username || 'Admin';

            const inId = 'REV_IN' + Date.now();
            batch.set(window.db.collection('transactions').doc(inId), { id: inId, sku: wVar.sku, fullBarcode: wrongBarcode.toUpperCase(), type: 'REVISI_IN', qty: 1, date: new Date().toISOString(), batchId, user: operatorName });

            const outId = 'REV_OUT' + Date.now();
            batch.set(window.db.collection('transactions').doc(outId), { id: outId, sku: rVar.sku, fullBarcode: rightBarcode.toUpperCase(), type: 'REVISI_OUT', qty: 1, date: new Date().toISOString(), batchId, user: operatorName });

            await batch.commit();
            playSuccess();
            showToast('success', 'Koreksi stok berhasil dicatat secara rahasia!');
            setWrongBarcode(''); setRightBarcode('');
            if (inputWrong.current) inputWrong.current.focus();
        } catch (err) { showToast('error', err.message); }
        setIsLoading(false);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 relative">
            {showCamera && (
                <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
                    <div className="bg-white p-6 rounded-2xl w-full max-w-md shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-xl flex items-center gap-2"><i className="fa-solid fa-camera text-orange-500"></i> Scan Kamera ({cameraTarget === 'wrong' ? 'Barang Salah' : 'Barang Benar'})</h3>
                            <button type="button" onClick={() => setShowCamera(false)} className="bg-red-50 text-red-600 p-2 rounded-full"><i className="fa-solid fa-xmark text-xl"></i></button>
                        </div>
                        <div id="reader-revisi" className="w-full rounded-xl overflow-hidden border-2 border-slate-300"></div>
                    </div>
                </div>
            )}

            <div className="bg-slate-900 p-8 rounded-3xl shadow-xl flex items-center justify-between text-white">
                <div>
                    <h2 className="text-3xl font-black flex items-center gap-3"><i className="fa-solid fa-right-left text-orange-500"></i> Menu Koreksi & Tukar Barang</h2>
                    <p className="text-slate-400 font-bold mt-2">Untuk Tim Picker: Kembalikan barang yang salah, ambil barang yang benar.</p>
                </div>
            </div>
            <form onSubmit={handleSwap} className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                <div className="bg-rose-50 p-8 rounded-3xl border-4 border-rose-200 text-center shadow-sm">
                    <i className="fa-solid fa-arrow-turn-down text-5xl text-rose-400 mb-4"></i>
                    <h3 className="font-black text-rose-800 text-xl mb-4">1. Scan Barang Salah</h3>
                    <div className="flex gap-2">
                        <input ref={inputWrong} required value={wrongBarcode} onChange={e => setWrongBarcode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); inputRight.current.focus(); } }} className="w-full p-4 border-2 border-rose-300 focus:border-rose-600 rounded-xl outline-none font-mono text-center font-bold text-lg bg-white" placeholder="SCAN BARCODE..." />
                        <button type="button" onClick={() => { setCameraTarget('wrong'); setShowCamera(true); }} className="bg-rose-200 hover:bg-rose-300 text-rose-800 px-4 rounded-xl shadow-sm"><i className="fa-solid fa-camera text-xl"></i></button>
                    </div>
                    {wrongBarcode && getVariantByFullBarcode(wrongBarcode) && <div className="mt-4 font-bold text-rose-700 bg-rose-200 p-2 rounded-lg">{getVariantByFullBarcode(wrongBarcode).article} - {getVariantByFullBarcode(wrongBarcode).sizeName}</div>}
                </div>
                <div className="bg-emerald-50 p-8 rounded-3xl border-4 border-emerald-200 text-center shadow-sm">
                    <i className="fa-solid fa-arrow-turn-up text-5xl text-emerald-400 mb-4"></i>
                    <h3 className="font-black text-emerald-800 text-xl mb-4">2. Scan Barang Benar</h3>
                    <div className="flex gap-2">
                        <input ref={inputRight} required value={rightBarcode} onChange={e => setRightBarcode(e.target.value)} className="w-full p-4 border-2 border-emerald-300 focus:border-emerald-600 rounded-xl outline-none font-mono text-center font-bold text-lg bg-white" placeholder="SCAN BARCODE..." />
                        <button type="button" onClick={() => { setCameraTarget('right'); setShowCamera(true); }} className="bg-emerald-200 hover:bg-emerald-300 text-emerald-800 px-4 rounded-xl shadow-sm"><i className="fa-solid fa-camera text-xl"></i></button>
                    </div>
                    {rightBarcode && getVariantByFullBarcode(rightBarcode) && <div className="mt-4 font-bold text-emerald-700 bg-emerald-200 p-2 rounded-lg">{getVariantByFullBarcode(rightBarcode).article} - {getVariantByFullBarcode(rightBarcode).sizeName}</div>}
                </div>
                <button type="submit" disabled={!wrongBarcode || !rightBarcode} className="md:col-span-2 bg-slate-900 hover:bg-black text-white font-black text-xl py-5 rounded-2xl shadow-xl disabled:opacity-50 transition-transform transform hover:-translate-y-1"><i className="fa-solid fa-bolt mr-2"></i> KONFIRMASI TUKAR BARANG</button>
            </form>
        </div>
    );
}

function HandoverKurir({ qcOrders, setIsLoading, showToast }) {
    const MOTIVASI_HANDOVER = ["Ayo semangat serahkan paketan ke kurir!", "Pastikan jumlah fisik dan sistem klop ya!", "Semangat! Paket siap dijemput janda beringas!", "Bismillah, rezeki lancar!"];
    const [resi, setResi] = useState('');
    const [activeEmployee, setActiveEmployee] = useState(null);
    const [motivasiMsg, setMotivasiMsg] = useState('');
    const [idInput, setIdInput] = useState('');
    const [isWorking, setIsWorking] = useState(false);
    // List paket yang sudah di-scan, menunggu konfirmasi SELESAI
    const [stagedList, setStagedList] = useState([]);
    const stagedListRef = useRef(stagedList);
    useEffect(() => { stagedListRef.current = stagedList; }, [stagedList]);

    const inputRef = useRef(null);
    const idInputRef = useRef(null);

    // TAMBAHAN KAMERA CONTINUOUS
    const [showCamera, setShowCamera] = useState(false);
    const lastScanRef = useRef({ text: '', time: 0 });

    useEffect(() => {
        let scanner = null;
        if (showCamera && isWorking) {
            const initScanner = () => {
                if (!window.Html5QrcodeScanner) return;
                scanner = new window.Html5QrcodeScanner('reader-handover', { fps: 10, qrbox: { width: 250, height: 250 } }, false);
                scanner.render((text) => {
                    const now = Date.now();
                    if (lastScanRef.current.text === text && now - lastScanRef.current.time < 2000) return;
                    lastScanRef.current = { text, time: now };
                    processScannerResi(text); // Langsung proses tanpa tutup kamera
                }, (err) => { });
            };
            if (!window.Html5QrcodeScanner) {
                const script = document.createElement('script'); script.src = 'https://unpkg.com/html5-qrcode'; script.onload = initScanner; document.head.appendChild(script);
            } else initScanner();
        }
        return () => { if (scanner) scanner.clear().catch(e => console.log(e)); };
    }, [showCamera, isWorking]);

    const handleIdSubmit = async (e) => {
        e.preventDefault();
        if (!idInput.trim()) return;
        const idVal = idInput.trim().toUpperCase();
        setIdInput('');

        try {
            const snap = await db.collection('employees').where('idKaryawan', '==', idVal).limit(1).get();
            if (!snap.empty) {
                const emp = snap.docs[0].data();
                setActiveEmployee(emp);
                const msg = MOTIVASI_HANDOVER[Math.floor(Math.random() * MOTIVASI_HANDOVER.length)];
                setMotivasiMsg(msg);
                playCekling();
                showToast('success', `✅ Selamat datang, ${emp.nama}! ${msg}`);
                setIsWorking(true);
            } else {
                playError();
                showToast('error', 'ID tidak ditemukan! Harap scan ID Card karyawan yang terdaftar.');
            }
        } catch (err) {
            playError();
            showToast('error', 'Gagal memverifikasi ID: ' + err.message);
        }
    };

    // Logika Proses Resi (Dipisah agar bisa dipanggil oleh Kamera & Keyboard)
    const processScannerResi = (scannedText) => {
        const val = scannedText.trim().toUpperCase();
        if (!val) return;

        if (stagedListRef.current.some(s => s.id === val)) {
            playError(); return showToast('error', 'Resi / Chart ini sudah ada dalam daftar.');
        }

        const cartOrders = qcOrders.filter(o => o.cartId === val && o.status === 'PACKED' && o.cartClosed === true);
        if (cartOrders.length > 0) {
            setStagedList(prev => {
                const filtered = prev.filter(s => !(s.type === 'RESI' && s.order && s.order.cartId === val));
                return [...filtered, { type: 'CART', id: val, cartId: val, orders: cartOrders, count: cartOrders.length }];
            });
            playSuccess(); showToast('success', `✅ Chart [${val}] masuk daftar.`);
            return;
        }

        const order = qcOrders.find(o => o.id.toUpperCase() === val);
        if (!order) { playError(); return showToast('error', 'Resi tidak dikenali di sistem.'); }
        if (order.status === 'SHIPPED') { playError(); return showToast('error', 'Paket ini sudah dikirim sebelumnya.'); }
        if (order.status !== 'PACKED') { playError(); return showToast('error', `Paket belum selesai QC! Status: ${order.status}`); }
        if (order.cartId && order.cartClosed !== true) { playError(); return showToast('error', `Paket ini ada di Keranjang [${order.cartId}] yang BELUM DISELESAIKAN QC-nya!`); }
        if (order.cartId && stagedListRef.current.some(s => s.type === 'CART' && s.cartId === order.cartId)) { playError(); return showToast('error', `Resi ini sudah termasuk dalam Chart [${order.cartId}].`); }

        setStagedList(prev => [...prev, { type: 'RESI', id: val, order, count: 1 }]);
        playSuccess(); showToast('success', `✅ Resi [${val}] masuk daftar.`);
    };

    const handleScan = async (e) => {
        e.preventDefault();
        if (!isWorking) return;
        processScannerResi(resi);
        setResi('');
        if (inputRef.current) inputRef.current.focus();
    };

    const handleRemoveStaged = (id) => {
        setStagedList(prev => prev.filter(s => s.id !== id));
    };

    // SELESAI ➜ batch SHIP semua yang ada di staged list
    const handleSelesai = async () => {
        if (stagedList.length === 0) return showToast('error', 'Belum ada paket yang di-scan.');
        const totalPaket = stagedList.reduce((a, s) => a + s.count, 0);
        if (!confirm(`Serahkan ${totalPaket} paket ke kurir sekarang?`)) return;
        setIsLoading(true);
        try {
            const batch = db.batch();
            stagedList.forEach(s => {
                if (s.type === 'CART') {
                    s.orders.forEach(o => batch.update(db.collection('qc_orders').doc(o.id), { status: 'SHIPPED', shippedAt: new Date().toISOString() }));
                } else {
                    batch.update(db.collection('qc_orders').doc(s.order.id), { status: 'SHIPPED', shippedAt: new Date().toISOString() });
                }
            });
            await batch.commit();
            playCekling();
            showToast('success', `${totalPaket} paket resmi diserahkan ke kurir! ✅`);
            playTTS(`${totalPaket} paket selesai`);
            setStagedList([]);
            setIsWorking(false);
            setActiveEmployee(null);
            setMotivasiMsg('');
        } catch (err) { showToast('error', err.message); }
        setIsLoading(false);
    };

    const handleIstirahat = () => {
        if (stagedList.length > 0) {
            if (!confirm(`Ada ${stagedList.reduce((a, s) => a + s.count, 0)} paket belum diserahkan. Istirahat dan batalkan daftar?`)) return;
        }
        setStagedList([]);
        setIsWorking(false);
        setActiveEmployee(null);
        setMotivasiMsg('');
        showToast('success', 'Istirahat dulu ya! 💤 Jangan lupa balik lagi.');
    };

    const shippedCount = qcOrders.filter(o => o.status === 'SHIPPED').length;
    // Hitung total resi unik: RESI = 1, CART = jumlah paket di dalam cart
    const totalStagedPaket = stagedList.reduce((a, s) => a + s.count, 0);
    // Jumlah entri di daftar (untuk label)
    const totalStagedEntries = stagedList.length;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {!isWorking ? (
                // LAYAR SCAN ID KARYAWAN
                <div className="bg-white p-16 rounded-3xl border border-slate-200 shadow-2xl text-center">
                    <i className="fa-solid fa-id-card text-8xl text-emerald-500 mb-8 mt-4 animate-bounce"></i>
                    <h2 className="text-4xl font-black text-slate-800 mb-4">HANDOVER KURIR</h2>
                    <p className="text-slate-500 font-bold mb-8 text-lg">Scan ID Card karyawan untuk mulai menyerahkan paket ke kurir.</p>
                    <form onSubmit={handleIdSubmit}>
                        <input ref={idInputRef} autoFocus value={idInput} onChange={e => setIdInput(e.target.value)} className="scan-input-big w-full max-w-xl p-4 md:p-5 text-xl md:text-2xl font-mono text-center border-4 border-teal-200 focus:border-teal-600 rounded-2xl outline-none shadow-inner bg-slate-50" placeholder="SCAN ID KARYAWAN..." />
                    </form>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* HEADER: foto karyawan + tombol aksi */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl flex items-center justify-between gap-4 relative">
                        <div className="flex items-center gap-5">
                            {activeEmployee && (
                                <>
                                    <div className="w-16 h-20 rounded-xl border-2 border-emerald-200 overflow-hidden bg-slate-100 shadow-md flex-shrink-0">
                                        {activeEmployee.foto
                                            ? <img src={activeEmployee.foto} className="w-full h-full object-cover" />
                                            : <div className="w-full h-full flex items-center justify-center text-slate-300 text-2xl"><i className="fa-solid fa-user"></i></div>
                                        }
                                    </div>
                                    <div>
                                        <div className="font-black text-slate-800 text-xl">{activeEmployee.nama}</div>
                                        <span className="bg-emerald-100 text-emerald-700 text-xs font-black uppercase px-2 py-1 rounded-md">{activeEmployee.posisi}</span>
                                        {motivasiMsg && <div className="text-yellow-700 font-bold text-sm mt-1">💪 {motivasiMsg}</div>}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* OVERLAY KAMERA */}
                    {showCamera && (
                        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
                            <div className="bg-white p-6 rounded-2xl w-full max-w-md shadow-2xl">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="font-bold text-xl flex items-center gap-2"><i className="fa-solid fa-camera text-emerald-600"></i> Scan Resi (Continuous)</h3>
                                    <button type="button" onClick={() => setShowCamera(false)} className="bg-red-50 text-red-600 p-2 rounded-full"><i className="fa-solid fa-xmark text-xl"></i></button>
                                </div>
                                <div id="reader-handover" className="w-full rounded-xl overflow-hidden border-2 border-slate-300"></div>
                            </div>
                        </div>
                    )}

                    {/* INPUT SCAN */}
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl">
                        <p className="text-slate-500 font-bold text-sm mb-3 text-center uppercase tracking-wide">Scan Resi atau ID Karung/Chart</p>
                        <div className="flex gap-4">
                            <form onSubmit={handleScan} className="flex-1">
                                <input ref={inputRef} autoFocus value={resi} onChange={e => setResi(e.target.value)} className="scan-input-big w-full p-4 md:p-5 text-xl md:text-2xl font-mono text-center border-4 border-slate-300 focus:border-teal-500 rounded-2xl outline-none shadow-inner bg-slate-50" placeholder="SCAN RESI / ID CHART..." />
                            </form>
                            <button type="button" onClick={() => setShowCamera(true)} className="bg-slate-800 hover:bg-slate-900 text-white px-8 rounded-2xl flex flex-col items-center justify-center font-bold text-sm shadow-xl transition-transform transform hover:-translate-y-1 border-b-4 border-slate-950">
                                <i className="fa-solid fa-camera text-3xl mb-1 text-emerald-400"></i> Kamera
                            </button>
                        </div>
                    </div>

                    {/* DAFTAR STAGED */}
                    {stagedList.length > 0 ? (
                        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                            <div className="bg-emerald-600 px-6 py-4 flex justify-between items-center">
                                <span className="text-white font-black text-lg"><i className="fa-solid fa-list-check mr-2"></i> Daftar Paket Siap Serah</span>
                                <span className="bg-white text-emerald-700 font-black px-4 py-1 rounded-full text-sm">{totalStagedPaket} Paket</span>
                            </div>
                            <div className="divide-y divide-slate-100">
                                {stagedList.map((s, idx) => (
                                    <div key={idx} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                                                <i className={`fa-solid ${s.type === 'CART' ? 'fa-boxes-stacked' : 'fa-box'} text-emerald-600`}></i>
                                            </div>
                                            <div>
                                                <div className="font-black text-slate-800 font-mono">{s.id}</div>
                                                <div className="text-xs text-slate-500 font-bold">{s.type === 'CART' ? `Karung • ${s.count} paket` : 'Resi individual'}</div>
                                            </div>
                                        </div>
                                        <button onClick={() => handleRemoveStaged(s.id)} className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 w-9 h-9 rounded-xl flex items-center justify-center transition-colors">
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <div className="bg-slate-50 px-6 py-4 flex justify-between items-center border-t border-slate-200">
                                <span className="text-slate-500 font-bold text-sm">Total Terkirim Hari Ini: <b className="text-emerald-700">{shippedCount} paket</b></span>
                                <button onClick={handleSelesai} className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-8 py-3 rounded-xl shadow-md flex items-center gap-2 transition-all hover:-translate-y-0.5">
                                    <i className="fa-solid fa-truck-fast"></i> SERAHKAN KE KURIR
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 py-12 text-center text-slate-400">
                            <i className="fa-solid fa-inbox text-5xl mb-3 block opacity-50"></i>
                            <p className="font-bold">Scan resi atau karung untuk mulai membuat daftar serah.</p>
                            <p className="text-xs mt-1">Daftar akan muncul di sini. Klik SELESAI untuk menyerahkan semua sekaligus.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ==========================================
// FITUR BARU: MANAJEMEN KARYAWAN & ID CARD
// ==========================================
function ManajemenKaryawan({ setIsLoading, showToast }) {
    const [employees, setEmployees] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const initialForm = { idKaryawan: '', nama: '', posisi: 'Staff Gudang', foto: '', noHp: '' };
    const [form, setForm] = useState(initialForm);
    const [editId, setEditId] = useState(null);

    // Ambil data karyawan dari Firebase
    useEffect(() => {
        const unsub = db.collection('employees').onSnapshot(snap => {
            setEmployees(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsub();
    }, []);

    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 800000) return showToast('error', "Ukuran foto terlalu besar! Maksimal 800kb.");
            const reader = new FileReader();
            reader.onload = () => setForm({ ...form, foto: reader.result });
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            if (editId) {
                await db.collection('employees').doc(editId).update(form);
                showToast('success', 'Data karyawan berhasil diupdate!');
            } else {
                const newId = 'EMP' + Date.now();
                // Jika ID Karyawan kosong, buat otomatis
                const finalForm = { ...form, idKaryawan: form.idKaryawan || `FRD-${Math.floor(Math.random() * 10000)}` };
                await db.collection('employees').doc(newId).set(finalForm);
                playConfirm();
                showToast('success', 'Karyawan baru berhasil ditambahkan!');
            }
            setShowForm(false);
            setForm(initialForm);
            setEditId(null);
        } catch (err) {
            showToast('error', 'Gagal menyimpan: ' + err.message);
        }
        setIsLoading(false);
    };

    const handleEdit = (emp) => {
        setForm({ idKaryawan: emp.idKaryawan, nama: emp.nama, posisi: emp.posisi, foto: emp.foto || '', noHp: emp.noHp || '' });
        setEditId(emp.id);
        setShowForm(true);
    };

    const handleDelete = async (id) => {
        if (confirm('Hapus data karyawan ini secara permanen?')) {
            setIsLoading(true);
            await db.collection('employees').doc(id).delete();
            setIsLoading(false);
            showToast('success', 'Karyawan dihapus');
        }
    };

    // Fungsi Cetak ID Card (Ukuran Standar Kartu)
    const cetakIDCard = (emp) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return showToast('error', "Gagal membuka tab baru. Izinkan Pop-up Blocker!");

        const fotoHtml = emp.foto ? `<img src="${emp.foto}" class="photo" />` : `<div class="no-photo"><i class="fa-solid fa-user"></i></div>`;
        const barcodeValue = emp.idKaryawan || emp.id;

        let htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
              <title>Cetak ID Card - ${emp.nama}</title>
              <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
              <style>
                @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Inter:wght@400;700;900&family=Oswald:wght@700&display=swap');
                
                @page { margin: 0; size: A4; }
                body { margin: 0; padding: 20px; font-family: 'Inter', sans-serif; background-color: #f1f5f9; display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; }
                
                .id-card { 
                  width: 54mm; 
                  height: 86mm; 
                  background-color: #f59e0b;
                  background-image: 
                    linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), 
                    linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px);
                  background-size: 8mm 8mm;
                  border-radius: 8px; 
                  box-shadow: 0 10px 25px rgba(0,0,0,0.15); 
                  overflow: hidden; 
                  position: relative; 
                  box-sizing: border-box;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  border: 1px solid #d97706;
                }

                .glare {
                  position: absolute;
                  top: -30%; left: -30%; width: 160%; height: 160%;
                  background: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 60%);
                  pointer-events: none; z-index: 2;
                }

                .frame-box {
                  position: absolute;
                  top: 15mm; left: 6mm; right: 6mm; bottom: 18mm;
                  border: 5px solid #ffffff; 
                  z-index: 3;
                  box-shadow: 5px 10px 20px rgba(0,0,0,0.3);
                  background: rgba(255,255,255,0.05);
                }

                .banner-bg {
                  position: absolute;
                  top: 23%; left: -10%; width: 120%;
                  background: #ffffff;
                  color: #d97706;
                  font-family: 'Oswald', sans-serif;
                  font-size: 26px;
                  font-weight: 900;
                  text-align: center;
                  transform: rotate(-10deg);
                  z-index: 4;
                  box-shadow: 0 5px 10px rgba(0,0,0,0.1);
                  line-height: 1.2;
                  letter-spacing: -1px;
                }

                .banner-fg {
                  position: absolute;
                  bottom: 30%; right: -15%; width: 80%;
                  background: #ffffff;
                  color: #f59e0b;
                  font-family: 'Oswald', sans-serif;
                  font-size: 16px;
                  font-weight: 900;
                  text-align: center;
                  transform: rotate(-15deg);
                  z-index: 6;
                  box-shadow: 2px 5px 10px rgba(0,0,0,0.2);
                  border: 2px solid #f59e0b;
                  line-height: 1.2;
                }

                .photo-area {
                  position: absolute; top: 10%; bottom: 0; left: -10%; right: -10%;
                  display: flex; justify-content: center; align-items: flex-end; z-index: 5;
                }
                .photo {
                  width: 100%; height: 100%; object-fit: contain; object-position: bottom center;
                  transform: scale(1.15); transform-origin: bottom center;
                  filter: drop-shadow(3px 3px 0 #fff) drop-shadow(-3px -3px 0 #fff) drop-shadow(3px -3px 0 #fff) drop-shadow(-3px 3px 0 #fff) drop-shadow(0px 10px 15px rgba(0,0,0,0.5));
                }
                .no-photo { font-size: 60px; color: rgba(255,255,255, 0.4); margin-bottom: 30px; }

                .huge-bottom {
                  position: absolute;
                  bottom: 0; left: 0; width: 100%;
                  font-family: 'Oswald', sans-serif;
                  font-size: 55px;
                  font-weight: 900;
                  color: rgba(255,255,255,0.4);
                  line-height: 0.8;
                  z-index: 3;
                  text-align: center;
                  transform: scaleY(1.3) translateY(-10mm);
                }

                .bottom-plate {
                  position: absolute; bottom: 8mm; left: 5mm; right: 5mm;
                  display: flex; z-index: 10;
                  box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                  border-radius: 4px; border: 2px solid white;
                  overflow: hidden;
                }
                .name-plate {
                  background: #ffffff; color: #d97706; flex: 1; text-align: center;
                  font-family: 'Oswald', sans-serif; font-size: 14px; font-weight: 900;
                  padding: 4px 6px; line-height: 1; text-transform: uppercase;
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .role-plate {
                  background: #0f172a; color: #fbbf24; text-align: center;
                  font-family: 'Oswald', sans-serif; font-size: 10px; font-weight: 900;
                  padding: 4px 8px; line-height: 1.4; text-transform: uppercase;
                  display: flex; justify-content: center; align-items: center;
                }

                .qr-wrapper {
                  position: absolute; top: 4mm; right: 4mm;
                  width: 12mm; height: 12mm; background: white; padding: 1px;
                  border-radius: 2px; z-index: 10; box-shadow: 0 4px 10px rgba(0,0,0,0.2);
                }
                #qrcode { display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; }

                .badge-top {
                  position: absolute; top: 4mm; left: 4mm;
                  background: #0f172a; color: white; font-family: 'Inter', sans-serif;
                  font-size: 6px; font-weight: 900; padding: 3px 6px; border-radius: 2px;
                  z-index: 10; letter-spacing: 0.5px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                }

                @media print { body { background: white; } .id-card { box-shadow: none; border: 1px solid #d97706; } }
              </style>
              <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
            </head>
            <body>
              <div class="id-card">
                <div class="glare"></div>
                <div class="huge-bottom">FARADELA</div>
                <div class="frame-box"></div>
                
                <div class="banner-bg">FARADELA TEAM</div>
                <div class="badge-top">NO: ${emp.idKaryawan || emp.id}</div>
                
                <div class="photo-area">${fotoHtml}</div>
                
                <div class="banner-fg">${emp.nama}</div>
                
                <div class="qr-wrapper">
                  <div id="qrcode"></div>
                </div>

                <div class="bottom-plate">
                  <div class="name-plate">${emp.nama}</div>
                  <div class="role-plate">${emp.posisi}</div>
                </div>
              </div>

              <script>
                window.onload = function() {
                  new QRCode(document.getElementById("qrcode"), {
                    text: "${barcodeValue}",
                    width: 40,
                    height: 40,
                    colorDark : "#0f172a",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.L
                  });
                  setTimeout(() => { window.print(); }, 1200);
                };
              <\/script>
            </body>
            </html>
          `;

        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 md:p-8 rounded-3xl border shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl md:text-2xl font-black text-slate-800 flex items-center gap-3"><i className="fa-solid fa-id-card text-orange-500"></i> Manajemen Karyawan</h2>
                    <p className="text-slate-500 font-bold text-sm mt-1">Data staf dan pembuatan ID Card Barcode.</p>
                </div>
                <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm(initialForm); }} className={`px-5 py-2.5 rounded-xl font-black transition-colors ${showForm ? 'bg-slate-200 text-slate-700' : 'bg-orange-500 text-white hover:bg-orange-600 shadow-md'}`}>
                    <i className={`fa-solid ${showForm ? 'fa-xmark' : 'fa-plus'} mr-2`}></i> {showForm ? 'Batal' : 'Tambah Karyawan'}
                </button>
            </div>

            {showForm && (
                <div className="bg-slate-50 p-6 md:p-8 rounded-3xl border-2 border-slate-200 shadow-inner animate-in fade-in zoom-in duration-300">
                    <h3 className="text-xl font-black text-slate-800 mb-6 border-b pb-4"><i className="fa-solid fa-user-pen mr-2 text-orange-500"></i> {editId ? 'Edit Data Karyawan' : 'Input Karyawan Baru'}</h3>
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <div><label className="block text-sm font-bold text-slate-700 mb-1">Nama Lengkap</label><input required value={form.nama} onChange={e => setForm({ ...form, nama: e.target.value.toUpperCase() })} className="w-full p-4 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 font-bold bg-white" placeholder="NAMA LENGKAP" /></div>
                            <div><label className="block text-sm font-bold text-slate-700 mb-1">ID Karyawan (Boleh Kosong)</label><input value={form.idKaryawan} onChange={e => setForm({ ...form, idKaryawan: e.target.value.toUpperCase() })} className="w-full p-4 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 font-mono bg-white" placeholder="ID KARYAWAN (OTOMATIS JIKA KOSONG)" /></div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Posisi / Jabatan</label>
                                <input required value={form.posisi || ''} onChange={e => setForm({ ...form, posisi: e.target.value })} className="w-full p-4 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 font-bold bg-white" placeholder="POSISI / JABATAN" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Foto Pas Karyawan (Max 800Kb)</label>
                            <label className="flex flex-col items-center justify-center w-full h-64 border-4 border-slate-300 border-dashed rounded-2xl cursor-pointer bg-white hover:bg-slate-100 transition-colors shadow-sm overflow-hidden relative">
                                {form.foto ? (
                                    <img src={form.foto} alt="Preview" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6 text-slate-400"><i className="fa-solid fa-camera-retro text-6xl mb-4"></i><p className="text-sm font-bold">Klik untuk upload foto</p></div>
                                )}
                                <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                            </label>
                        </div>
                        <div className="md:col-span-2 pt-6 border-t border-slate-200">
                            <button type="submit" className="w-full md:w-auto bg-orange-500 hover:bg-orange-600 text-white px-8 py-3.5 rounded-xl font-black shadow-lg shadow-orange-500/30 transition-transform transform hover:-translate-y-1"><i className="fa-solid fa-save mr-2"></i> SIMPAN DATA KARYAWAN</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {employees.map(emp => (
                    <div key={emp.id} className="bg-white p-6 rounded-3xl border-2 border-slate-100 shadow-sm flex flex-col justify-between hover:border-orange-300 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 rounded-bl-full -z-10 transition-transform group-hover:scale-110"></div>
                        <div className="flex items-start gap-4 mb-6">
                            <div className="w-20 h-24 rounded-xl border-2 border-slate-200 overflow-hidden bg-slate-100 flex-shrink-0 shadow-sm">
                                {emp.foto ? <img src={emp.foto} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-slate-300 text-3xl"><i className="fa-solid fa-user"></i></div>}
                            </div>
                            <div>
                                <h3 className="font-black text-slate-800 text-lg leading-tight mb-1">{emp.nama}</h3>
                                <span className="bg-orange-100 text-orange-600 text-[10px] font-black uppercase px-2 py-1 rounded-md">{emp.posisi}</span>
                                <div className="mt-3 text-xs font-mono text-slate-500 font-bold"><i className="fa-solid fa-barcode mr-1"></i> {emp.idKaryawan}</div>
                            </div>
                        </div>
                        <div className="flex gap-2 border-t border-slate-100 pt-4">
                            <button onClick={() => cetakIDCard(emp)} className="flex-1 bg-slate-900 hover:bg-black text-white py-2.5 rounded-xl font-bold text-xs shadow-sm transition-colors"><i className="fa-solid fa-print mr-1"></i> Cetak ID</button>
                            <button onClick={() => handleEdit(emp)} className="w-10 h-10 bg-amber-50 hover:bg-amber-500 hover:text-white text-amber-500 rounded-xl font-bold flex items-center justify-center transition-colors"><i className="fa-solid fa-pen"></i></button>
                            <button onClick={() => handleDelete(emp.id)} className="w-10 h-10 bg-rose-50 hover:bg-rose-500 hover:text-white text-rose-500 rounded-xl font-bold flex items-center justify-center transition-colors"><i className="fa-solid fa-trash-can"></i></button>
                        </div>
                    </div>
                ))}

                {employees.length === 0 && (
                    <div className="md:col-span-2 lg:col-span-3 text-center py-16 text-slate-400 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                        <i className="fa-solid fa-users-slash text-6xl mb-4 opacity-50"></i>
                        <h3 className="text-xl font-black text-slate-600 mb-1">Belum Ada Data Karyawan</h3>
                        <p className="font-bold text-sm">Klik tombol "Tambah Karyawan" di atas untuk memasukkan data.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
// 1. Dashboard
function Dashboard({ transactions, qcOrders, mpoOrders = [], variants = [] }) {
    const [range, setRange] = useState('hari');
    const [customRange, setCustomRange] = useState({ start: '', end: '' });
    const [isResetting, setIsResetting] = useState(false);
    const [historyModal, setHistoryModal] = useState(null); // { type, title }
    const [selectedSession, setSelectedSession] = useState(null);

    const getLaporanDefaultStart = () => {
        const now = new Date();
        if (now.getHours() < 9) now.setDate(now.getDate() - 1);
        return now.toISOString().split('T')[0] + 'T09:00';
    };
    const getLaporanDefaultEnd = () => {
        const now = new Date();
        if (now.getHours() >= 9) now.setDate(now.getDate() + 1);
        return now.toISOString().split('T')[0] + 'T08:30';
    };

    const [laporanModal, setLaporanModal] = useState(false);
    const [laporanMulai, setLaporanMulai] = useState(getLaporanDefaultStart());
    const [laporanSelesai, setLaporanSelesai] = useState(getLaporanDefaultEnd());
    const [laporanTeks, setLaporanTeks] = useState('');

    // --- KAS OPERASIONAL STATE ---
    const [kasData, setKasData] = useState([]);
    const [kasLoaded, setKasLoaded] = useState(false);
    const [kasModal, setKasModal] = useState(false);
    const [kasDetailItem, setKasDetailItem] = useState(null);

    // Load data kas dari Firestore (sekali saat mount)
    useEffect(() => {
        db.collection('kas_operasional').orderBy('timestamp', 'asc').get()
            .then(snap => {
                setKasData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setKasLoaded(true);
            })
            .catch(() => setKasLoaded(true));
    }, []);

    // Hitung saldo total (semua waktu)
    const totalSaldoKas = useMemo(() => {
        return kasData.reduce((sum, d) => d.jenis === 'masuk' ? sum + d.nominal : sum - d.nominal, 0);
    }, [kasData]);

    // Kas yang difilter sesuai range (untuk modal)
    const kasFiltered = useMemo(() => {
        const now = new Date();
        return kasData.filter(d => {
            const tDate = new Date(d.tanggal);
            if (range === 'hari') return d.tanggal === now.toISOString().split('T')[0];
            if (range === 'kemarin') {
                const yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);
                return d.tanggal === yesterday.toISOString().split('T')[0];
            }
            if (range === 'minggu') return (now - tDate) / 864e5 <= 7;
            if (range === 'bulan') return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
            if (range === 'tahun') return tDate.getFullYear() === now.getFullYear();
            if (range === 'custom' && customRange.start && customRange.end) return tDate >= new Date(customRange.start) && tDate <= new Date(customRange.end + 'T23:59:59');
            return false;
        }).sort((a, b) => {
            const ta = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.tanggal);
            const tb = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.tanggal);
            return tb - ta;
        });
    }, [kasData, range, customRange]);

    // Helper: Group transactions into "Scanning Sessions" (Sama User & Time Proximity < 30 mins)
    const getGroupedSessions = (txs) => {
        if (!txs || txs.length === 0) return [];
        const sorted = [...txs].sort((a, b) => new Date(b.date) - new Date(a.date));
        const sessions = [];
        let currentSession = null;

        sorted.forEach(t => {
            const tDate = new Date(t.date);
            // Logika: Jika ada batchId, gunakan sebagai pengunci grup. 
            // Jika tidak ada (data lama), gunakan jarak 30 menit.
            const isSameBatch = t.batchId && currentSession && currentSession.batchId === t.batchId;
            const isSameTimeWindow = !t.batchId && currentSession &&
                !currentSession.batchId &&
                currentSession.user === t.user &&
                (new Date(currentSession.lastDate) - tDate) <= 30 * 60 * 1000;

            if (isSameBatch || isSameTimeWindow) {
                currentSession.items.push(t);
                currentSession.totalQty += t.qty;
                currentSession.skus.add(t.sku);
            } else {
                if (currentSession) sessions.push(currentSession);
                currentSession = {
                    id: t.batchId || ('S-' + t.date),
                    batchId: t.batchId || null,
                    date: t.date,
                    lastDate: t.date,
                    user: t.user || 'Unknown',
                    items: [t],
                    totalQty: t.qty,
                    skus: new Set([t.sku])
                };
            }
        });
        if (currentSession) sessions.push(currentSession);
        return sessions;
    };

    const stats = useMemo(() => {
        const now = new Date();
        return transactions.reduce((acc, t) => {
            const tDate = new Date(t.date);
            let match = false;
            if (range === 'hari') match = tDate.toDateString() === now.toDateString();
            else if (range === 'kemarin') {
                const yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);
                match = tDate.toDateString() === yesterday.toDateString();
            }
            else if (range === 'minggu') match = (now - tDate) / 864e5 <= 7;
            else if (range === 'bulan') match = tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
            else if (range === 'tahun') match = tDate.getFullYear() === now.getFullYear();
            else if (range === 'custom' && customRange.start && customRange.end) match = tDate >= new Date(customRange.start) && tDate <= new Date(customRange.end + 'T23:59:59');

            if (match) {
                if (t.type === 'IN') acc.in += t.qty;
                // Sembunyikan transaksi OUT QC agar tidak merusak angka kinerja Picker
                else if (t.type === 'OUT' && !(t.note && (t.note.toLowerCase().includes('qc') || t.note.toLowerCase().includes('packing')))) acc.out += t.qty;
            }
            return acc;
        }, { in: 0, out: 0 });
    }, [transactions, range, customRange]);

    const qcStats = useMemo(() => {
        return {
            pending: qcOrders.filter(o => o.status === 'PENDING' && (o.items || []).some(it => it.status === 'PO')).length,
            transit: qcOrders.filter(o => o.status === 'TRANSIT').length,
            packed: qcOrders.filter(o => o.status === 'PACKED').length,
            shipped: qcOrders.filter(o => o.status === 'SHIPPED').length,
        }
    }, [qcOrders]);

    // LOGIKA PINTAR AHMAD: Bandingkan Antrean Masuk dengan Stok Fisik Induk + Siluman
    const tungguOnline = useMemo(() => {
        const demandMap = {};
        (qcOrders || []).filter(o => (o.status === 'PENDING' || o.status === 'TRANSIT') && !o.isCanceled).forEach(order => {
            (order.items || []).filter(it => (it.prodStatus || it.status) === 'PO').forEach(item => {
                const fullSku = (item.sysSku || item.sku || '').trim().toUpperCase();
                const cleanSku = fullSku.split('*')[0].split('#')[0];
                demandMap[cleanSku] = (demandMap[cleanSku] || 0) + Number(item.qty || 0);
            });
        });

        const virtualStock = {};
        (transactions || []).forEach(t => {
            let cleanSku = (t.sku || '').trim().toUpperCase();
            if (cleanSku.startsWith('*')) cleanSku = cleanSku.substring(1).trim();
            if (cleanSku.startsWith('#')) cleanSku = cleanSku.substring(1).trim();

            if (t.type === 'OUT' && t.note && (t.note.toLowerCase().includes('qc') || t.note.toLowerCase().includes('packing'))) {
                virtualStock[cleanSku] = (virtualStock[cleanSku] || 0) - t.qty;
            }
        });

        let kekurangan = 0;
        Object.keys(demandMap).forEach(sku => {
            const demand = demandMap[sku];
            const variant = (variants || []).find(v => v.sku === sku);
            const realStock = variant ? Number(variant.stock || variant.stok || 0) : 0;
            const crossDockStock = virtualStock[sku] || 0;

            const totalStock = realStock + crossDockStock;
            if (demand > totalStock) kekurangan += (demand - totalStock);
        });
        return Math.max(0, kekurangan);
    }, [qcOrders, variants, transactions]);
    // REPORT GENERATION
    const generateLaporan = () => {
        const start = new Date(laporanMulai);
        const end = new Date(laporanSelesai);
        let saldoText = kasLoaded ? `Rp ${totalSaldoKas.toLocaleString('id-ID')}` : '...';

        let inTotal = 0, outTotal = 0;
        let inDetails = { 'PO Nota': 0, 'Resize': 0, 'Retur': 0, 'Repair': 0, 'Revisi': 0 };
        let outDetails = { 'Penjualan (Off + Online)': 0, 'Resize': 0, 'Lainnya': 0, 'Reject': 0, 'Endors & Affiliate': 0 };

        (transactions || []).forEach(t => {
            const tDate = new Date(t.date);
            if (tDate >= start && tDate <= end) {
                if (t.type === 'IN' || t.type === 'ONLINE_IN' || t.type === 'REVISI_IN') {
                    inTotal += t.qty;
                    if (t.type === 'ONLINE_IN') inDetails['PO Nota'] += t.qty;
                    else if (t.type === 'REVISI_IN') inDetails['Revisi'] += t.qty;
                    else {
                        const cat = t.category || 'PO Nota';
                        if (inDetails[cat] !== undefined) inDetails[cat] += t.qty;
                        else if (cat === 'Tukar (Resize)') inDetails['Resize'] += t.qty;
                        else inDetails['PO Nota'] += t.qty;
                    }
                }
                if (t.type === 'OUT' || t.type === 'ONLINE_OUT' || t.type === 'REVISI_OUT') {
                    outTotal += t.qty;
                    if (t.type === 'ONLINE_OUT') outDetails['Penjualan (Off + Online)'] += t.qty;
                    // Note: Usually REVISI_OUT is not explicitly requested, but we can treat it as part of outTotal
                    else {
                        const cat = t.category || 'Penjualan (Off + Online)';
                        if (cat === 'Lainnya') outDetails['Lainnya'] += t.qty;
                        else if (cat === 'Tukar (Resize)') outDetails['Resize'] += t.qty;
                        else if (cat === 'Reject') outDetails['Reject'] += t.qty;
                        else outDetails['Penjualan (Off + Online)'] += t.qty;
                    }
                }
            }
        });

        let onlineResi = 0, onlinePcs = 0;
        let affiliateResi = 0, affiliatePcs = 0;
        let totalPesananClosedOrder = 0;

        Object.values(qcOrders || {}).forEach(o => {
            // 1. Hitung Total Pesanan Closed Order (Berdasarkan waktu IMPORT / batchTimestamp)
            // Hindari fallback ke Date() agar pesanan lama tanpa tanggal tidak terhitung di hari ini
            const importTimestamp = o.batchTimestamp || o.createdAt || o.timestamp || o.date || 0;
            const importDate = new Date(importTimestamp);
            if (importTimestamp !== 0 && importDate >= start && importDate <= end) {
                const totalPcs = (o.items || []).reduce((sum, item) => sum + item.qty, 0);
                if (['SHOPEE', 'TIKTOK', 'LAZADA'].includes(o.platform) || (o.platform === 'MANUAL' && o.sumber !== 'Resize') || (o.platform && o.platform.toLowerCase().includes('affiliate'))) {
                    totalPesananClosedOrder += totalPcs;
                }
            }

            // Hitung "Pesanan Online" (HANYA barang yang PO / stok kosong / dikirim ke Produksi)
            // Menggunakan poReleasedTimestamp (saat klik Kirim ke Produksi) atau fallback ke batchTimestamp
            const poTimestamp = o.poReleasedTimestamp || importTimestamp;
            const poDateVal = new Date(poTimestamp);
            if (poTimestamp !== 0 && poDateVal >= start && poDateVal <= end) {
                if (['SHOPEE', 'TIKTOK', 'LAZADA'].includes(o.platform)) {
                    const poItems = (o.items || []).filter(item => item.status === 'PO' || item.status === 'UNRECOGNIZED');
                    const poQty = poItems.reduce((sum, item) => sum + item.qty, 0);
                    onlinePcs += poQty;
                    if (poQty > 0) onlineResi += 1;
                }
            }

            // 2. Hitung Detail Scan Out (Hanya untuk yang sudah PACKED/SHIPPED)
            if (o.status === 'PACKED' || o.status === 'SHIPPED') {
                const actionTimestamp = o.packedAt || o.shippedAt || 0;
                const actionDate = new Date(actionTimestamp);
                if (actionTimestamp !== 0 && actionDate >= start && actionDate <= end) {
                    const totalPcs = (o.items || []).reduce((sum, item) => sum + item.qty, 0);
                    // Hitung Reject dari defect
                    const totalDefect = (o.items || []).reduce((sum, item) => sum + (item.defect || 0), 0);
                    outDetails['Reject'] += totalDefect;

                    if (o.platform && o.platform.toLowerCase().includes('affiliate')) {
                        affiliateResi += 1;
                        affiliatePcs += totalPcs;
                        outDetails['Endors & Affiliate'] += totalPcs;
                    } else if (['SHOPEE', 'TIKTOK', 'LAZADA', 'MANUAL'].includes(o.platform)) {
                        if (o.platform === 'MANUAL' && o.sumber === 'Endorse/Affiliate') {
                            affiliateResi += 1;
                            affiliatePcs += totalPcs;
                            outDetails['Endors & Affiliate'] += totalPcs;
                        } else if (o.platform === 'MANUAL' && o.sumber === 'Resize') {
                            outDetails['Resize'] += totalPcs;
                        }
                        // onlineResi dan onlinePcs TIDAK dihitung di sini, karena 'Pesanan Online' 
                        // dimaksudkan untuk barang PO, bukan barang ready yang di-scan out.
                    }
                }
            }
        });

        // PENGURANGAN MATEMATIS
        // Sesuai rule: Reject TETAP masuk ke laporan penjualan offline dan online karena barang penggantinya di-scan ulang.
        // Affiliate/Endorse dan Resize DIPISAH (dikurangi) dari Penjualan agar murni berada di barisnya sendiri.
        const purePenjualan = outDetails['Penjualan (Off + Online)'] - outDetails['Endors & Affiliate'] - outDetails['Resize'];
        outDetails['Penjualan (Off + Online)'] = purePenjualan < 0 ? 0 : purePenjualan;

        const formatDateHeader = (d) => d.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        const teks = `Laporan Sinkronisasi ${formatDateHeader(start)}:

1. Saldo Cash = ${saldoText}
2. Total Pesanan Closed Order = ${totalPesananClosedOrder} Pcs
3. Total Brg Masuk ( Scan In ) : 
* PO Nota = ${inDetails['PO Nota']}
* Resize = ${inDetails['Resize']}
* Retur = ${inDetails['Retur']}
* Repair = ${inDetails['Repair']}
4. Total Brg Keluar ( Scan Out ) :
* Penjualan ( Off + Online ) = ${outDetails['Penjualan (Off + Online)']}
* Resize = ${outDetails['Resize']}
* Lainnya (...) = ${outDetails['Lainnya']}
* Reject = ${outDetails['Reject']}
* Endors & Affiliate = ${outDetails['Endors & Affiliate']}
5. Total Pesanan Online = ${onlinePcs} Pcs ( ${onlineResi} Resi )
`;
        setLaporanTeks(teks);
    };

    const copyLaporan = () => {
        navigator.clipboard.writeText(laporanTeks).then(() => alert('Laporan berhasil disalin!'));
    };

    // COPY PASTE: Perhitungan Sisa PO Pabrik persis dari Surat Jalan
    const pendingPO = (mpoOrders || []).filter(o => o.status === 'OPEN' || o.status === 'SHIPPED')
        .reduce((acc, po) => acc + (po.items || []).reduce((s, i) => s + Math.max(0, (i.qty || 0) - (i.received || 0)), 0), 0);

    const handleResetAntrean = async () => {
        if (!confirm(`PERINGATAN KERAS! ⚠️\n\nAnda akan menghapus SELURUH data Sistem Pesanan Online (SPO) secara PERMANEN, meliputi:\n1. Semua Antrean QC\n2. Semua Riwayat Pesanan (History)\n3. Semua Draft Antrean Produksi\n\nTindakan ini tidak bisa dibatalkan. Yakin ingin RESET TOTAL?`)) return;

        setIsResetting(true);
        // Karena Dashboard tidak punya prop showToast, kita gunakan alert/loading state lokal
        try {
            const deleteCollection = async (collectionName) => {
                const snap = await db.collection(collectionName).get();
                let batch = db.batch();
                let count = 0;
                for (const doc of snap.docs) {
                    batch.delete(doc.ref);
                    count++;
                    if (count === 450) {
                        await batch.commit();
                        batch = db.batch();
                        count = 0;
                    }
                }
                if (count > 0) await batch.commit();
            };

            await deleteCollection('qc_orders');
            await deleteCollection('po_drafts');
            await deleteCollection('online_history');

            alert('RESET TOTAL BERHASIL! Seluruh data pesanan online telah dibersihkan.');
        } catch (e) {
            alert('Terjadi kesalahan saat reset: ' + e.message);
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-4 md:p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
                <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                    {['hari', 'kemarin', 'minggu', 'bulan', 'tahun', 'custom'].map(r => (
                        <button key={r} type="button" onClick={() => setRange(r)} className={`flex-1 md:flex-none px-4 md:px-5 py-2.5 rounded-xl text-sm md:text-base font-bold capitalize transition-colors ${range === r ? 'bg-slate-900 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{r}</button>
                    ))}
                </div>
                {range === 'custom' && (
                    <div className="flex flex-col sm:flex-row gap-2 items-center bg-slate-50 p-3 rounded-2xl border w-full md:w-auto">
                        <input type="date" className="w-full sm:w-auto bg-white border rounded-xl p-2.5 text-sm md:text-base outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700" onChange={e => setCustomRange({ ...customRange, start: e.target.value })} />
                        <span className="text-slate-400 font-black hidden sm:inline">-</span>
                        <input type="date" className="w-full sm:w-auto bg-white border rounded-xl p-2.5 text-sm md:text-base outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700" onChange={e => setCustomRange({ ...customRange, end: e.target.value })} />
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                <StatCard
                    title="Barang Masuk (Produksi)"
                    value={stats.in}
                    icon="fa-right-to-bracket"
                    color="text-teal-700"
                    bg="bg-teal-100"
                    onClick={() => setHistoryModal({ type: 'IN', title: 'Riwayat Barang Masuk (Produksi)' })}
                />
                <StatCard
                    title="Barang Keluar (Picker)"
                    value={stats.out}
                    icon="fa-right-from-bracket"
                    color="text-red-700"
                    bg="bg-red-100"
                    onClick={() => setHistoryModal({ type: 'OUT', title: 'Riwayat Barang Keluar (Picker)' })}
                />
                {/* KARTU SALDO KAS */}
                <div
                    onClick={() => setKasModal(true)}
                    className="cursor-pointer bg-gradient-to-br from-amber-500 to-orange-600 p-5 md:p-6 rounded-3xl shadow-md hover:shadow-lg hover:scale-[1.02] transition-all flex items-center gap-4 group"
                >
                    <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 group-hover:bg-white/30 transition-colors">
                        <i className="fa-solid fa-wallet text-white text-2xl"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-white/80 text-xs font-black uppercase tracking-widest">Saldo Kas Operasional</div>
                        <div className="text-white text-2xl md:text-3xl font-black leading-tight mt-0.5 truncate">
                            {kasLoaded ? `Rp ${totalSaldoKas.toLocaleString('id-ID')}` : '...'}
                        </div>
                        <div className={`text-xs font-bold mt-1 ${totalSaldoKas >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                            {totalSaldoKas >= 0 ? 'Saldo Aman' : 'Saldo Minus!'} &middot; Klik untuk riwayat
                        </div>
                    </div>
                    <i className="fa-solid fa-chevron-right text-white/40 group-hover:text-white/70 transition-colors"></i>
                </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-200">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                    <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><i className="fa-solid fa-radar text-orange-500"></i> Pantauan Live QC & Packing</h3>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <button onClick={() => { generateLaporan(); setLaporanModal(true); }} className="bg-emerald-100 hover:bg-emerald-600 text-emerald-700 hover:text-white px-5 py-2.5 rounded-xl font-black text-sm transition-colors flex items-center gap-2 border border-emerald-200 shadow-sm flex-1 md:flex-none justify-center">
                            <i className="fa-solid fa-clipboard-list"></i> BUAT LAPORAN
                        </button>
                        <button onClick={handleResetAntrean} disabled={isResetting || qcStats.pending === 0} className="bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white px-5 py-2.5 rounded-xl font-black text-sm transition-colors flex items-center gap-2 border border-rose-200 disabled:opacity-50 shadow-sm flex-1 md:flex-none justify-center">
                            {isResetting ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-trash-can"></i>}
                            TARIK / KOSONGKAN
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white border p-4 rounded-2xl shadow-sm text-center">
                        <div className="text-3xl font-black text-slate-400">{qcStats.pending}</div>
                        <div className="text-xs font-bold text-slate-500 uppercase mt-1">Antrean Masuk</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl shadow-sm text-center">
                        <div className="text-3xl font-black text-amber-600">{tungguOnline}</div>
                        <div className="text-xs font-bold text-amber-700 uppercase mt-1">Tunggu Pesanan Online</div>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 p-4 rounded-2xl shadow-sm text-center">
                        <div className="text-3xl font-black text-orange-500">{qcStats.packed}</div>
                        <div className="text-xs font-bold text-orange-600 uppercase mt-1">Selesai QC (Siap Kirim)</div>
                    </div>
                    <div className="bg-teal-50 border border-teal-200 p-4 rounded-2xl shadow-sm text-center">
                        <div className="text-3xl font-black text-teal-700">{qcStats.shipped}</div>
                        <div className="text-xs font-bold text-teal-700 uppercase mt-1">Sudah di Kurir</div>
                    </div>
                </div>

                {mpoOrders.filter(o => o.status === 'OPEN' || o.status === 'ARRIVED').length > 0 && (
                    <div className="mt-8 pt-6 border-t border-slate-200">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2"><i className="fa-solid fa-list-check text-orange-500"></i> Status PO Pabrik Terbaru</h3>
                            {/* KOTAK SISA PO BENGKEL GABUNGAN */}
                            <div className="bg-orange-50 text-orange-600 px-4 py-2 rounded-xl font-black text-sm border border-orange-200 shadow-sm">
                                <i className="fa-solid fa-box mr-2"></i>SISA PO SEMUA BENGKEL: {pendingPO} Pcs
                            </div>
                        </div>
                        <div className="bg-slate-50 border rounded-2xl overflow-hidden shadow-inner">
                            <table className="w-full text-left bg-white">
                                <thead className="bg-slate-100 text-slate-700 border-b-2">
                                    <tr>
                                        <th className="p-4 font-black">No. PO</th>
                                        <th className="p-4 font-black">Target Selesai</th>
                                        {/* KOLOM TERKIRIM DIHAPUS */}
                                        <th className="p-4 font-black text-center">Progress (Diterima Gudang)</th>
                                        <th className="p-4 font-black text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {mpoOrders.filter(o => ['OPEN', 'SHIPPED', 'ARRIVED'].includes(o.status)).sort((a, b) => b.poNumber - a.poNumber).slice(0, 5).map(po => {
                                        const totalOrderQty = po.items.reduce((acc, curr) => acc + curr.qty, 0);
                                        // MENGGUNAKAN DATA RECEIVED AGAR MENJADI 0 / 2 PCS
                                        const totalRcvQty = po.items.reduce((acc, curr) => acc + (curr.received || 0), 0);
                                        const isArrived = po.status === 'ARRIVED';
                                        return (
                                            <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="p-4 font-black text-slate-800">{po.id}</td>
                                                <td className="p-4 font-bold text-slate-600">
                                                    {(() => {
                                                        const curDate = new Date().toISOString().split('T')[0];
                                                        const dt = po.targetDate || curDate;
                                                        if (dt === curDate) return <span className="text-rose-600 font-black animate-pulse">HARI INI</span>;
                                                        if (dt < curDate) return <span className="text-red-500 font-black">TERLAMBAT ({dt})</span>;
                                                        return dt;
                                                    })()}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <div className="font-bold text-sm mb-1 text-orange-600">{totalRcvQty} / {totalOrderQty} Pcs</div>
                                                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                                        <div className={`bg-${isArrived ? 'teal-500' : 'orange-500'} h-1.5 rounded-full`} style={{ width: `${Math.round((totalRcvQty / totalOrderQty) * 100) || 0}%` }}></div>
                                                    </div>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className={`bg-${isArrived ? 'teal' : (po.status === 'SHIPPED' ? 'blue' : 'amber')}-100 text-${isArrived ? 'teal' : (po.status === 'SHIPPED' ? 'blue' : 'amber')}-700 text-xs font-black uppercase px-2 py-1 rounded-md`}>{po.status}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* MODAL RIWAYAT SCAN DASHBOARD (Grouped & Detailed) */}
            {historyModal && (() => {
                const allFilteredTx = transactions.filter(t => {
                    const tDate = new Date(t.date);
                    const now = new Date();
                    let rangeMatch = false;
                    if (range === 'hari') rangeMatch = tDate.toDateString() === now.toDateString();
                    else if (range === 'kemarin') {
                        const yesterday = new Date(now);
                        yesterday.setDate(now.getDate() - 1);
                        rangeMatch = tDate.toDateString() === yesterday.toDateString();
                    }
                    else if (range === 'minggu') rangeMatch = (now - tDate) / 864e5 <= 7;
                    else if (range === 'bulan') rangeMatch = tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
                    else if (range === 'tahun') rangeMatch = tDate.getFullYear() === now.getFullYear();
                    else if (range === 'custom' && customRange.start && customRange.end) rangeMatch = tDate >= new Date(customRange.start) && tDate <= new Date(customRange.end + 'T23:59:59');

                    if (!rangeMatch) return false;

                    if (historyModal.type === 'IN') {
                        return t.type === 'IN'; // Jangan masukkan ONLINE_IN ke riwayat barang masuk
                    } else {
                        return t.type === 'OUT' && !(t.note && (t.note.toLowerCase().includes('qc') || t.note.toLowerCase().includes('packing')));
                    }
                });

                const sessions = getGroupedSessions(allFilteredTx);

                return (
                    <div className="fixed inset-0 bg-slate-900/80 z-[100] flex items-center justify-center p-2 md:p-4 backdrop-blur-sm animate-in fade-in duration-200 no-print">
                        <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in duration-300">
                            {/* HEADER */}
                            <div className={`p-4 md:p-6 border-b flex justify-between items-center ${historyModal.type === 'IN' ? 'bg-teal-50 border-teal-100' : 'bg-rose-50 border-rose-100'}`}>
                                <div className="flex items-center gap-3">
                                    {selectedSession && (
                                        <button onClick={() => setSelectedSession(null)} className="w-10 h-10 rounded-xl bg-white/80 hover:bg-white text-slate-600 flex items-center justify-center shadow-sm transition-transform active:scale-95">
                                            <i className="fa-solid fa-arrow-left"></i>
                                        </button>
                                    )}
                                    <div>
                                        <h3 className={`text-lg md:text-xl font-black ${historyModal.type === 'IN' ? 'text-teal-800' : 'text-rose-800'}`}>
                                            {selectedSession ? 'Detail Item Scan' : historyModal.title}
                                        </h3>
                                        <p className="text-slate-500 font-bold text-[10px] md:text-xs uppercase tracking-widest leading-none mt-1">
                                            {selectedSession ? `Oleh: ${selectedSession.user} | ${new Date(selectedSession.date).toLocaleString('id-ID')}` : `Periode: ${range} ${range === 'custom' ? `(${customRange.start} s/d ${customRange.end})` : ''}`}
                                        </p>
                                    </div>
                                </div>
                                <button onClick={() => { setHistoryModal(null); setSelectedSession(null); }} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                                    <i className="fa-solid fa-xmark text-xl"></i>
                                </button>
                            </div>

                            {/* CONTENT */}
                            <div className="flex-1 overflow-hidden flex flex-col">
                                {!selectedSession ? (
                                    /* LEVEL 1: LIST GROUPED SESSIONS */
                                    <div className="flex-1 overflow-y-auto p-2 md:p-6 custom-scrollbar bg-slate-50">
                                        {sessions.length === 0 ? (
                                            <div className="text-center py-20 text-slate-400">
                                                <i className="fa-solid fa-clock-rotate-left text-5xl mb-4 opacity-20 block"></i>
                                                <p className="font-bold uppercase tracking-widest text-sm">Belum ada aktivitas scan</p>
                                            </div>
                                        ) : (
                                            <div className="bg-white border rounded-2xl overflow-x-auto custom-scrollbar shadow-sm">
                                                <table className="w-full text-left border-collapse min-w-[380px] md:min-w-0">
                                                    <thead className="bg-slate-100/50 border-b">
                                                        <tr className="text-slate-400 text-[10px] md:text-xs font-black uppercase tracking-widest">
                                                            <th className="px-2 py-3 md:p-4 font-black">Tanggal</th>
                                                            <th className="px-2 py-3 md:p-4 font-black hidden md:table-cell">Operator</th>
                                                            <th className="px-2 py-3 md:p-4 font-black text-center whitespace-nowrap">SKU</th>
                                                            <th className="px-2 py-3 md:p-4 font-black text-center whitespace-nowrap">QTY</th>
                                                            <th className="px-2 py-3 md:p-4 font-black text-center"><span className="md:hidden">ST</span><span className="hidden md:inline">Status</span></th>
                                                            <th className="px-2 py-3 md:p-4 font-black text-right">Actions</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100 uppercase">
                                                        {sessions.map((session, idx) => (
                                                            <tr key={idx} className="hover:bg-blue-50/30 transition-colors text-xs md:text-sm font-bold text-slate-700">
                                                                <td className="px-2 py-3 md:p-4">
                                                                    <div className="text-slate-900 leading-tight">{new Date(session.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' })}</div>
                                                                    <div className="text-[9px] text-slate-400 font-mono mt-0.5">{new Date(session.date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                                                                </td>
                                                                <td className="px-2 py-3 md:p-4 font-black text-slate-500 hidden md:table-cell">{session.user}</td>
                                                                <td className="px-2 py-3 md:p-4 text-center text-slate-600">{session.skus.size}</td>
                                                                <td className="px-2 py-3 md:p-4 text-center text-slate-600">{session.totalQty}</td>
                                                                <td className="px-2 py-3 md:p-4 text-center">
                                                                    <div className="inline-flex items-center justify-center w-6 h-6 bg-emerald-500 text-white rounded-full text-[9px] shadow-sm"><i className="fa-solid fa-check"></i></div>
                                                                </td>
                                                                <td className="px-2 py-3 md:p-4 text-right">
                                                                    <button onClick={() => setSelectedSession(session)} className="bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-1.5 md:px-4 md:py-2 rounded-lg font-black text-[9px] md:text-xs shadow-md shadow-emerald-500/20 flex items-center gap-1 ml-auto">
                                                                        DETAIL <i className="fa-solid fa-chevron-right text-[7px]"></i>
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* LEVEL 2: DETAILED ITEM LIST */
                                    <div className="flex-1 overflow-y-auto p-2 md:p-6 custom-scrollbar">
                                        <div className="mb-4 bg-slate-50 p-4 rounded-2xl border flex items-center justify-between">
                                            <div className="flex gap-4">
                                                <div className="text-center bg-white px-4 py-2 rounded-xl shadow-sm border">
                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Variasi Produk</div>
                                                    <div className="text-xl font-black text-slate-800 leading-none">{selectedSession.skus.size}</div>
                                                </div>
                                                <div className="text-center bg-white px-4 py-2 rounded-xl shadow-sm border">
                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Total Pieces</div>
                                                    <div className="text-xl font-black text-emerald-600 leading-none">{selectedSession.totalQty} <span className="text-xs">PCS</span></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="bg-white border rounded-2xl overflow-x-auto custom-scrollbar shadow-sm">
                                            <table className="w-full text-left border-collapse min-w-[380px] md:min-w-0">
                                                <thead className="sticky top-0 bg-white z-10 shadow-sm border-b">
                                                    <tr className="text-slate-400 text-[10px] sm:text-xs font-black uppercase tracking-widest">
                                                        <th className="pb-3 md:pb-4 font-black px-2">Waktu</th>
                                                        <th className="pb-3 md:pb-4 font-black px-2">Article / SKU</th>
                                                        <th className="pb-3 md:pb-4 font-black px-2">Varian</th>
                                                        <th className="pb-3 md:pb-4 font-black text-center px-2">Qty</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {selectedSession.items.map((t, idx) => {
                                                        const variant = variants.find(v => v.sku === t.sku);
                                                        return (
                                                            <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                                                <td className="py-3 md:py-4 px-2">
                                                                    <div className="font-black text-slate-800 text-xs md:text-sm">{new Date(t.date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                                                                </td>
                                                                <td className="py-3 md:py-4 px-2">
                                                                    <div className="font-black text-slate-800 text-xs md:text-sm">{variant ? variant.article : t.sku}</div>
                                                                    <div className="text-[10px] text-slate-400 font-mono translate-y-[-2px]">{t.sku}</div>
                                                                </td>
                                                                <td className="py-3 md:py-4 px-2">
                                                                    <div className="font-bold text-slate-600 text-[10px] md:text-xs uppercase">{variant ? `${variant.colorName} - ${variant.sizeName}` : '-'}</div>
                                                                </td>
                                                                <td className="py-3 md:py-4 px-2 text-center">
                                                                    <span className={`inline-block px-2 md:px-3 py-1 rounded-lg font-black text-xs md:text-sm ${historyModal.type === 'IN' ? 'bg-teal-50 text-teal-700 border border-teal-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                                                                        {t.qty}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* FOOTER */}
                            <div className="p-4 bg-slate-50 border-t flex justify-between items-center no-print">
                                <p className="text-[10px] font-bold text-slate-400 italic">Klik baris atau tombol detail untuk melihat pemecahan per item.</p>
                                <button onClick={() => { setHistoryModal(null); setSelectedSession(null); }} className="px-6 py-2.5 bg-slate-800 text-white rounded-xl font-black text-xs md:text-sm shadow-lg active:scale-95 transition-transform">TUTUP</button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* MODAL LAPORAN */}
            {laporanModal && (
                <div className="fixed inset-0 bg-slate-900/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200 no-print">
                    <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in duration-300">
                        <div className="p-6 border-b flex justify-between items-center bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-100">
                            <h3 className="font-black text-xl text-slate-800 flex items-center gap-3"><i className="fa-solid fa-clipboard-list text-emerald-500"></i> Buat Laporan Harian</h3>
                            <button onClick={() => setLaporanModal(false)} className="text-slate-400 hover:text-rose-500 bg-white hover:bg-rose-50 w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm border"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                        <div className="p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="flex-1">
                                    <label className="text-[10px] font-black uppercase text-slate-500 mb-1 block">Waktu Mulai</label>
                                    <div className="flex items-center w-full rounded-xl border border-slate-300 bg-slate-50 overflow-hidden focus-within:border-emerald-500 transition-colors shadow-sm">
                                        <input type="date" value={laporanMulai.split('T')[0]} onChange={e => setLaporanMulai(e.target.value + 'T' + (laporanMulai.split('T')[1] || '09:00'))} onBlur={generateLaporan} className="flex-1 p-2 bg-transparent font-bold text-sm outline-none cursor-pointer" />
                                        <div className="flex items-center bg-slate-200/50 px-2 py-2 border-l border-slate-300">
                                            <select value={laporanMulai.split('T')[1]?.split(':')[0] || '09'} onChange={e => setLaporanMulai(laporanMulai.split('T')[0] + 'T' + e.target.value + ':' + (laporanMulai.split('T')[1]?.split(':')[1] || '00'))} onBlur={generateLaporan} className="bg-transparent font-black text-sm outline-none cursor-pointer text-slate-700 appearance-none text-center">
                                                {Array.from({length: 24}).map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}</option>)}
                                            </select>
                                            <span className="mx-1 font-black text-slate-400">:</span>
                                            <select value={laporanMulai.split('T')[1]?.split(':')[1] || '00'} onChange={e => setLaporanMulai(laporanMulai.split('T')[0] + 'T' + (laporanMulai.split('T')[1]?.split(':')[0] || '09') + ':' + e.target.value)} onBlur={generateLaporan} className="bg-transparent font-black text-sm outline-none cursor-pointer text-slate-700 appearance-none text-center">
                                                {Array.from({length: 60}).map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-slate-300 font-black mt-4">-</div>
                                <div className="flex-1">
                                    <label className="text-[10px] font-black uppercase text-slate-500 mb-1 block">Waktu Selesai</label>
                                    <div className="flex items-center w-full rounded-xl border border-slate-300 bg-slate-50 overflow-hidden focus-within:border-emerald-500 transition-colors shadow-sm">
                                        <input type="date" value={laporanSelesai.split('T')[0]} onChange={e => setLaporanSelesai(e.target.value + 'T' + (laporanSelesai.split('T')[1] || '08:30'))} onBlur={generateLaporan} className="flex-1 p-2 bg-transparent font-bold text-sm outline-none cursor-pointer" />
                                        <div className="flex items-center bg-slate-200/50 px-2 py-2 border-l border-slate-300">
                                            <select value={laporanSelesai.split('T')[1]?.split(':')[0] || '08'} onChange={e => setLaporanSelesai(laporanSelesai.split('T')[0] + 'T' + e.target.value + ':' + (laporanSelesai.split('T')[1]?.split(':')[1] || '30'))} onBlur={generateLaporan} className="bg-transparent font-black text-sm outline-none cursor-pointer text-slate-700 appearance-none text-center">
                                                {Array.from({length: 24}).map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}</option>)}
                                            </select>
                                            <span className="mx-1 font-black text-slate-400">:</span>
                                            <select value={laporanSelesai.split('T')[1]?.split(':')[1] || '30'} onChange={e => setLaporanSelesai(laporanSelesai.split('T')[0] + 'T' + (laporanSelesai.split('T')[1]?.split(':')[0] || '08') + ':' + e.target.value)} onBlur={generateLaporan} className="bg-transparent font-black text-sm outline-none cursor-pointer text-slate-700 appearance-none text-center">
                                                {Array.from({length: 60}).map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button onClick={generateLaporan} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-black text-xs py-2 rounded-lg mb-4 shadow-sm transition-colors">GENERATE ULANG</button>

                            <textarea value={laporanTeks} readOnly className="w-full h-64 p-4 rounded-xl border border-slate-200 bg-slate-50 font-mono text-sm resize-none focus:outline-none whitespace-pre-wrap" />
                            
                            <button onClick={copyLaporan} className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-base py-3.5 rounded-xl shadow-lg shadow-emerald-500/30 transition-transform transform hover:-translate-y-0.5"><i className="fa-solid fa-copy mr-2"></i> COPY TEXT LAPORAN</button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL RIWAYAT KAS OPERASIONAL */}
            {kasModal && (
                <div className="fixed inset-0 bg-slate-900/80 z-[100] flex items-center justify-center p-2 md:p-4 backdrop-blur-sm animate-in fade-in duration-200 no-print">
                    <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in duration-300">
                        {/* HEADER */}
                        <div className="p-4 md:p-6 border-b flex justify-between items-center bg-gradient-to-r from-amber-50 to-orange-50 border-amber-100">
                            <div className="flex items-center gap-3">
                                {kasDetailItem && (
                                    <button onClick={() => setKasDetailItem(null)} className="w-10 h-10 rounded-xl bg-white/80 hover:bg-white text-slate-600 flex items-center justify-center shadow-sm transition-transform active:scale-95">
                                        <i className="fa-solid fa-arrow-left"></i>
                                    </button>
                                )}
                                <div>
                                    <h3 className="text-lg md:text-xl font-black text-amber-800">
                                        {kasDetailItem ? 'Detail Transaksi Kas' : 'Riwayat Kas Operasional'}
                                    </h3>
                                    <p className="text-slate-500 font-bold text-[10px] md:text-xs uppercase tracking-widest leading-none mt-1">
                                        {kasDetailItem ? kasDetailItem.tanggal : `Periode: ${range}`}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => { setKasModal(false); setKasDetailItem(null); }} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>

                        {/* CONTENT */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                            {!kasDetailItem ? (
                                <div className="flex-1 overflow-y-auto p-3 md:p-6 custom-scrollbar bg-slate-50 space-y-3">
                                    {/* Ringkasan periode */}
                                    <div className="grid grid-cols-3 gap-3 mb-2">
                                        <div className="bg-white border rounded-2xl p-3 text-center shadow-sm">
                                            <div className="text-[10px] font-black text-teal-600 uppercase">Masuk</div>
                                            <div className="text-sm font-black text-teal-700 mt-0.5">
                                                Rp {kasFiltered.filter(d => d.jenis === 'masuk').reduce((s, d) => s + d.nominal, 0).toLocaleString('id-ID')}
                                            </div>
                                        </div>
                                        <div className="bg-white border rounded-2xl p-3 text-center shadow-sm">
                                            <div className="text-[10px] font-black text-red-600 uppercase">Keluar</div>
                                            <div className="text-sm font-black text-red-700 mt-0.5">
                                                Rp {kasFiltered.filter(d => d.jenis === 'keluar').reduce((s, d) => s + d.nominal, 0).toLocaleString('id-ID')}
                                            </div>
                                        </div>
                                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center shadow-sm">
                                            <div className="text-[10px] font-black text-amber-700 uppercase">Saldo Total</div>
                                            <div className={`text-sm font-black mt-0.5 ${totalSaldoKas >= 0 ? 'text-amber-700' : 'text-red-700'}`}>
                                                Rp {totalSaldoKas.toLocaleString('id-ID')}
                                            </div>
                                        </div>
                                    </div>

                                    {kasFiltered.length === 0 ? (
                                        <div className="text-center py-16 text-slate-400">
                                            <i className="fa-solid fa-wallet text-5xl mb-4 opacity-20 block"></i>
                                            <p className="font-bold uppercase tracking-widest text-sm">Tidak ada transaksi di periode ini</p>
                                        </div>
                                    ) : (
                                        <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                                            <table className="w-full text-left border-collapse">
                                                <thead className="bg-slate-50 border-b">
                                                    <tr className="text-slate-400 text-[10px] font-black uppercase tracking-widest">
                                                        <th className="px-3 py-3">Tanggal</th>
                                                        <th className="px-3 py-3">Keterangan</th>
                                                        <th className="px-3 py-3 text-center">Jenis</th>
                                                        <th className="px-3 py-3 text-right">Nominal</th>
                                                        <th className="px-3 py-3 text-center">Aksi</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {kasFiltered.map((item, idx) => (
                                                        <tr key={idx} className="hover:bg-amber-50/40 transition-colors text-sm font-bold">
                                                            <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                                                                <div>{item.tanggal}</div>
                                                                {item.timestamp?.toDate && (
                                                                    <div className="text-[9px] font-mono text-slate-400">
                                                                        {item.timestamp.toDate().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-3 text-slate-700 max-w-[160px] truncate">{item.keterangan}</td>
                                                            <td className="px-3 py-3 text-center">
                                                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${item.jenis === 'masuk' ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-700'}`}>
                                                                    {item.jenis === 'masuk' ? '▲ Masuk' : '▼ Keluar'}
                                                                </span>
                                                            </td>
                                                            <td className={`px-3 py-3 text-right font-black ${item.jenis === 'masuk' ? 'text-teal-700' : 'text-red-600'}`}>
                                                                {item.jenis === 'masuk' ? '+' : '-'}Rp {item.nominal.toLocaleString('id-ID')}
                                                            </td>
                                                            <td className="px-3 py-3 text-center">
                                                                <button onClick={() => setKasDetailItem(item)} className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-black text-[10px] shadow-sm flex items-center gap-1 mx-auto">
                                                                    DETAIL <i className="fa-solid fa-chevron-right text-[7px]"></i>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* DETAIL TRANSAKSI */
                                <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar space-y-4">
                                    <div className="bg-slate-50 border rounded-2xl p-4 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-500 font-bold text-sm">Tanggal</span>
                                            <span className="font-black text-slate-800">{kasDetailItem.tanggal}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-500 font-bold text-sm">Jenis</span>
                                            <span className={`px-3 py-1 rounded-xl font-black text-sm ${kasDetailItem.jenis === 'masuk' ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-700'}`}>
                                                {kasDetailItem.jenis === 'masuk' ? '▲ Uang Masuk' : '▼ Uang Keluar'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-500 font-bold text-sm">Nominal</span>
                                            <span className={`font-black text-xl ${kasDetailItem.jenis === 'masuk' ? 'text-teal-700' : 'text-red-600'}`}>
                                                Rp {kasDetailItem.nominal.toLocaleString('id-ID')}
                                            </span>
                                        </div>
                                        <div className="pt-2 border-t">
                                            <div className="text-slate-500 font-bold text-sm mb-1">Keterangan</div>
                                            <div className="font-bold text-slate-800">{kasDetailItem.keterangan}</div>
                                        </div>
                                    </div>
                                    {kasDetailItem.buktiUrl && (
                                        <div>
                                            <div className="text-slate-500 font-black text-xs uppercase mb-2"><i className="fa-solid fa-camera mr-1"></i>Foto Bukti</div>
                                            <img src={kasDetailItem.buktiUrl} alt="Bukti" className="w-full rounded-2xl border shadow-sm object-cover max-h-64" />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* FOOTER */}
                        <div className="p-4 bg-slate-50 border-t flex justify-end">
                            <button onClick={() => { setKasModal(false); setKasDetailItem(null); }} className="px-6 py-2.5 bg-slate-800 text-white rounded-xl font-black text-xs md:text-sm shadow-lg active:scale-95 transition-transform">TUTUP</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function StatCard({ title, value, icon, color, bg, onClick }) {
    return (
        <div
            onClick={onClick}
            className={`bg-white p-5 md:p-7 rounded-2xl border-2 border-slate-100 shadow-sm flex items-center gap-4 md:gap-6 transition-all active:scale-95 group ${onClick ? 'cursor-pointer hover:border-orange-300 hover:shadow-md' : ''}`}
        >
            <div className={`w-14 h-14 md:w-16 md:h-16 rounded-xl ${bg} ${color} flex items-center justify-center shadow-inner flex-shrink-0 transition-transform group-hover:scale-110`}><i className={`fa-solid ${icon} text-2xl md:text-3xl`}></i></div>
            <div className="flex-1">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{title}</p>
                <div className="flex items-end justify-between">
                    <p className="text-3xl md:text-4xl font-black text-slate-800">{value}</p>
                    {onClick && <i className="fa-solid fa-chevron-right text-slate-300 text-sm md:text-base group-hover:text-orange-500 transition-colors"></i>}
                </div>
            </div>
        </div>
    );
}

// 2. Upload Produk (Master)
function UploadProduk({ products, setIsLoading, showToast }) {
    const initialForm = { article: '', baseCode: '', photo: '', buyPrice: 0, sellPrice: 0 };
    const [form, setForm] = useState(initialForm);
    const [colors, setColors] = useState([{ name: '', code: '' }]);
    const [sizes, setSizes] = useState([{ name: '', code: '', buyPrice: '', sellPrice: '' }]);
    const [editId, setEditId] = useState(null);

    const toggleStatus = async (id, currentStatus) => {
        setIsLoading(true); await db.collection('products').doc(id).update({ isActive: !currentStatus }); setIsLoading(false);
        showToast('success', 'Status produk berhasil diubah');
    };

    const handleEdit = (product) => {
        setForm({ article: product.article, baseCode: product.baseCode, photo: product.photo, buyPrice: product.buyPrice, sellPrice: product.sellPrice });
        setColors(product.colors || [{ name: '', code: '' }]); setSizes(product.sizes || [{ name: '', code: '' }]); setEditId(product.id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelEdit = () => { setForm(initialForm); setColors([{ name: '', code: '' }]); setSizes([{ name: '', code: '', buyPrice: '', sellPrice: '' }]); setEditId(null); };

    const deleteProduct = async (id) => {
        if (confirm("Hapus produk ini secara permanen dari server?")) {
            setIsLoading(true); await db.collection('products').doc(id).delete(); setIsLoading(false); showToast('success', 'Produk dihapus permanen');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (colors.some(c => !c.name || !c.code) || sizes.some(s => !s.name || !s.code)) return showToast('error', "Pastikan semua nama dan kode variasi terisi!");
        if (form.photo && form.photo.length > 900000) return showToast('error', "Ukuran foto terlalu besar! Maksimal 800kb.");
        setIsLoading(true);
        const dataToSave = { ...form, colors: [...colors], sizes: [...sizes], isActive: true };
        try {
            if (editId) { await db.collection('products').doc(editId).update(dataToSave); showToast('success', 'Produk berhasil diupdate!'); }
            else { dataToSave.id = 'P' + Date.now(); await db.collection('products').doc(dataToSave.id).set(dataToSave); playConfirm(); showToast('success', 'Produk baru ditambahkan!'); }
            cancelEdit();
        } catch (err) { showToast('error', 'Gagal simpan: ' + err.message); }
        setIsLoading(false);
    };

    return (
        <div className="space-y-8">
            <div className={`p-8 rounded-3xl border-4 shadow-xl transition-colors ${editId ? 'bg-amber-50 border-amber-300' : 'bg-white border-white'}`}>
                <div className="flex justify-between items-center border-b border-slate-200 pb-5 mb-8">
                    <h3 className="text-2xl font-black text-slate-800 flex items-center">
                        <div className={`w-14 h-14 flex items-center justify-center rounded-2xl mr-4 text-white shadow-md ${editId ? 'bg-amber-500' : 'bg-orange-500'}`}><i className={`fa-solid ${editId ? 'fa-pen-to-square' : 'fa-upload'} text-2xl`}></i></div>
                        {editId ? 'Edit Master Produk' : 'Input Master Produk Baru'}
                    </h3>
                    {editId && <button type="button" onClick={cancelEdit} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-5 py-3 rounded-xl font-bold shadow-sm transition-colors"><i className="fa-solid fa-xmark mr-2"></i> Batal Edit</button>}
                </div>

                <form onSubmit={handleSubmit} action="javascript:void(0);">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div className="space-y-6">
                            <h4 className="font-bold text-lg text-slate-800 flex items-center"><span className="bg-slate-800 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs mr-2">1</span> Informasi Utama</h4>
                            <div className="space-y-4">
                                <div><label className="block text-sm font-bold text-slate-700 mb-1">Nama Article</label><input required type="text" value={form.article} onChange={e => setForm({ ...form, article: e.target.value.toUpperCase() })} className="w-full px-5 py-3.5 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 uppercase bg-white shadow-inner font-bold text-slate-800" placeholder="CONTOH: F01-04.1" /></div>
                                <div><label className="block text-sm font-bold text-slate-700 mb-1">Kode Barcode Utama (Article)</label><input required type="text" value={form.baseCode} onChange={e => setForm({ ...form, baseCode: e.target.value })} className="w-full px-5 py-3.5 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 font-mono bg-white shadow-inner text-slate-800" placeholder="Contoh: 01041" /></div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="block text-sm font-bold text-slate-700 mb-1">Harga Beli</label><div className="relative"><span className="absolute left-4 top-4 text-slate-400 font-black">Rp</span><input required type="number" value={form.buyPrice} onChange={e => setForm({ ...form, buyPrice: e.target.value })} className="w-full pl-11 pr-4 py-3.5 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 bg-white shadow-inner font-bold text-slate-800" placeholder="0" /></div></div>
                                    <div><label className="block text-sm font-bold text-slate-700 mb-1">Harga Jual</label><div className="relative"><span className="absolute left-4 top-4 text-slate-400 font-black">Rp</span><input required type="number" value={form.sellPrice} onChange={e => setForm({ ...form, sellPrice: e.target.value })} className="w-full pl-11 pr-4 py-3.5 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 bg-white shadow-inner font-bold text-slate-800" placeholder="0" /></div></div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Foto SKU (Max 800Kb)</label>
                                    <label className="flex flex-col items-center justify-center w-full h-48 border-4 border-slate-300 border-dashed rounded-2xl cursor-pointer bg-white hover:bg-slate-50 transition-colors shadow-sm">
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                            {form.photo ? <img src={form.photo} alt="Preview" className="h-40 object-contain rounded-xl" /> : <><i className="fa-solid fa-cloud-arrow-up text-5xl mb-4 text-orange-400"></i><p className="text-sm text-slate-600 font-bold">Klik untuk upload foto</p></>}
                                        </div>
                                        <input type="file" className="hidden" accept="image/*" onChange={e => {
                                            const file = e.target.files[0];
                                            if (file) { const reader = new FileReader(); reader.onload = () => setForm({ ...form, photo: reader.result }); reader.readAsDataURL(file); }
                                        }} />
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-8">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                    <h4 className="font-bold text-lg text-slate-800 flex items-center"><span className="bg-slate-800 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs mr-2">2</span> Variasi Warna & Kode</h4>
                                    <button type="button" onClick={() => setColors([...colors, { name: '', code: '' }])} className="bg-orange-100 hover:bg-orange-500 hover:text-white transition-colors text-orange-600 px-4 py-2 rounded-xl text-xs font-black shadow-sm"><i className="fa-solid fa-plus mr-1"></i> Tambah</button>
                                </div>
                                {colors.map((c, i) => (
                                    <div key={i} className="flex gap-3 items-start animate-in slide-in-from-top-2">
                                        <input required type="text" value={c.name} onChange={e => { const n = [...colors]; n[i].name = e.target.value; setColors(n); }} className="flex-1 px-5 py-3.5 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 text-sm bg-white shadow-inner font-bold" placeholder="Nama (ex: Hitam)" />
                                        <input required type="text" value={c.code} onChange={e => { const n = [...colors]; n[i].code = e.target.value; setColors(n); }} className="w-1/3 px-5 py-3.5 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 text-sm font-mono bg-white shadow-inner font-bold" placeholder="Kode (ex: 1)" />
                                        {colors.length > 1 && <button type="button" onClick={() => { const n = [...colors]; n.splice(i, 1); setColors(n); }} className="w-12 h-[52px] flex items-center justify-center text-red-500 bg-red-50 hover:bg-red-500 hover:text-white rounded-xl transition-colors shadow-sm"><i className="fa-solid fa-trash-can text-lg"></i></button>}
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                    <h4 className="font-bold text-lg text-slate-800 flex items-center"><span className="bg-slate-800 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs mr-2">3</span> Variasi Size & Kode</h4>
                                    <button type="button" onClick={() => setSizes([...sizes, { name: '', code: '', buyPrice: '', sellPrice: '' }])} className="bg-orange-100 hover:bg-orange-500 hover:text-white transition-colors text-orange-600 px-4 py-2 rounded-xl text-xs font-black shadow-sm"><i className="fa-solid fa-plus mr-1"></i> Tambah</button>
                                </div>
                                {sizes.map((s, i) => (
                                    <div key={i} className="flex flex-col gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl animate-in slide-in-from-top-2">
                                        <div className="flex gap-3 items-start">
                                            {/* Input Size yang sudah dimodifikasi agar otomatis mengisi Kode */}
                                            <input required type="text" value={s.name} onChange={e => {
                                                const n = [...sizes];
                                                n[i].name = e.target.value;
                                                n[i].code = e.target.value; // Otomatis menduplikasi input nama size menjadi kode barcode
                                                setSizes(n);
                                            }} className="flex-1 px-4 py-3 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 text-sm bg-white shadow-inner font-bold" placeholder="Size (ex: 37)" />

                                            {/* Input Kode dihapus dari sini */}

                                            {sizes.length > 1 && <button type="button" onClick={() => { const n = [...sizes]; n.splice(i, 1); setSizes(n); }} className="w-12 h-[48px] flex items-center justify-center text-red-500 bg-red-100 hover:bg-red-500 hover:text-white rounded-xl transition-colors shadow-sm"><i className="fa-solid fa-trash-can text-lg"></i></button>}
                                        </div>
                                        <div className="flex flex-col sm:flex-row gap-3 mt-2">
                                            <div className="relative w-full">
                                                <span className="absolute left-3 top-3 text-slate-400 font-bold text-[10px] uppercase tracking-wider">Beli Rp</span>
                                                <input type="number" value={s.buyPrice || ''} onChange={e => { const n = [...sizes]; n[i].buyPrice = e.target.value; setSizes(n); }} className="w-full pl-16 pr-3 py-2.5 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 text-sm md:text-base bg-white shadow-inner font-bold text-slate-800" placeholder={form.buyPrice || "Sesuai Pusat"} />
                                            </div>
                                            <div className="relative w-full">
                                                <span className="absolute left-3 top-3 text-slate-400 font-bold text-[10px] uppercase tracking-wider">Jual Rp</span>
                                                <input type="number" value={s.sellPrice || ''} onChange={e => { const n = [...sizes]; n[i].sellPrice = e.target.value; setSizes(n); }} className="w-full pl-16 pr-3 py-2.5 border-2 border-slate-300 rounded-xl outline-none focus:border-orange-500 text-sm md:text-base bg-white shadow-inner font-bold text-slate-800" placeholder={form.sellPrice || "Sesuai Pusat"} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="mt-10 pt-8 border-t border-slate-200 flex justify-end">
                        <button type="submit" className={`w-full md:w-auto px-12 py-5 rounded-2xl font-black text-lg text-white shadow-xl transition-transform transform hover:-translate-y-1 ${editId ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30' : 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/30'}`}>
                            <i className={`fa-solid ${editId ? 'fa-pen-to-square' : 'fa-save'} mr-3`}></i> {editId ? 'UPDATE MASTER PRODUK' : 'SIMPAN MASTER PRODUK'}
                        </button>
                    </div>
                </form>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden">
                <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-black text-xl text-slate-800"><i className="fa-solid fa-list-ul text-orange-500 mr-2"></i> Daftar Produk</h3>
                    <span className="bg-blue-200 text-blue-900 font-black px-4 py-1.5 rounded-full text-sm shadow-inner">{products.length} Produk</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-100 text-slate-700 text-sm border-b-4 border-slate-200">
                            <tr><th className="p-5 font-black uppercase">Detail Produk</th><th className="p-5 font-black uppercase">Harga Beli / Jual</th><th className="p-5 font-black uppercase">Status</th><th className="p-5 font-black text-right uppercase">Aksi</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {products.map(p => (
                                <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${!p.isActive ? 'bg-slate-50 opacity-60' : ''}`}>
                                    <td className="p-5 flex items-center gap-5">
                                        <img src={p.photo} className="w-16 h-16 rounded-xl object-cover shadow-md border-2 border-white" />
                                        <div><div className="font-black text-slate-900 text-lg">{p.article}</div><div className="text-xs font-mono text-orange-600 font-bold bg-orange-100 px-2 py-1 rounded-md inline-block mt-1">Kode: {p.baseCode}</div></div>
                                    </td>
                                    <td className="p-5">
                                        <div className="font-bold text-slate-700 text-base">{formatRp(p.buyPrice)}</div>
                                        <div className="text-sm text-emerald-600 font-black mt-1">{formatRp(p.sellPrice)}</div>
                                    </td>
                                    <td className="p-5">
                                        <span className={`px-4 py-2 rounded-xl text-xs font-black shadow-sm ${p.isActive ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-200 text-slate-600 border border-slate-300'}`}>{p.isActive ? 'AKTIF' : 'NONAKTIF'}</span>
                                    </td>
                                    <td className="p-5 text-right space-x-3 whitespace-nowrap">
                                        <button type="button" onClick={() => toggleStatus(p.id, p.isActive)} className={`w-12 h-12 rounded-xl border shadow-sm transition-colors ${p.isActive ? 'bg-white text-slate-600 hover:bg-slate-200' : 'bg-slate-800 text-white'}`} title="Ubah Status">
                                            {p.isActive ? <i className="fa-solid fa-eye-slash"></i> : <i className="fa-solid fa-eye"></i>}
                                        </button>
                                        <button type="button" onClick={() => handleEdit(p)} className="w-12 h-12 rounded-xl border shadow-sm transition-colors bg-white text-amber-500 hover:bg-amber-500 hover:text-white border-amber-200" title="Edit Produk">
                                            <i className="fa-solid fa-pen"></i>
                                        </button>
                                        <button type="button" onClick={() => deleteProduct(p.id)} className="w-12 h-12 bg-white border shadow-sm rounded-xl hover:bg-red-500 hover:text-white border-red-200 text-red-500 transition-colors" title="Hapus Permanen">
                                            <i className="fa-solid fa-trash-can"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {products.length === 0 && <tr><td colSpan="4" className="p-12 text-center text-slate-500 font-bold text-lg"><i className="fa-solid fa-box-open text-4xl block mb-3 text-slate-300"></i> Belum ada master produk.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// 3. Transaksi Scan (Masuk/Keluar)
function TransaksiScan({ type, variants, transactions, setIsLoading, showToast, currentUser }) {
    const draftKey = `scan_draft_${type}`;
    const isMasuk = type === 'IN';
    const inputRef = useRef(null);
    const [showCamera, setShowCamera] = useState(false);
    const lastScanRef = useRef({ text: '', time: 0 }); // TAMBAHAN UNTUK KAMERA CONTINUOUS
    const [kategoriScan, setKategoriScan] = useState(isMasuk ? 'PO Nota' : 'Penjualan (Off + Online)');

    const [scannedItems, setScannedItems] = useState(() => {
        try {
            const savedDraft = localStorage.getItem(draftKey);
            if (savedDraft) return JSON.parse(savedDraft);
        } catch (e) { }
        return [];
    });

    const scannedItemsRef = useRef(scannedItems);

    const availableStockMap = useMemo(() => {
        const map = {};
        if (!isMasuk) {
            transactions.forEach(t => {
                if (!t.fullBarcode) return;
                if (!map[t.fullBarcode]) map[t.fullBarcode] = 0;
                if (t.type === 'IN' || t.type === 'REVISI_IN') map[t.fullBarcode] += t.qty;
                if (t.type === 'OUT' || t.type === 'REVISI_OUT') map[t.fullBarcode] -= t.qty;
            });
        }
        return map;
    }, [transactions, isMasuk]);

    const variantsRef = useRef(variants);
    const stockRef = useRef(availableStockMap);
    useEffect(() => { variantsRef.current = variants; }, [variants]);
    useEffect(() => { stockRef.current = availableStockMap; }, [availableStockMap]);

    const processBarcode = (scannedText) => {
        const cleanBarcode = scannedText.trim().toUpperCase();
        if (!cleanBarcode) return;

        const isShortcode = cleanBarcode.startsWith('$');
        const isLegacySystemBarcode = cleanBarcode.length > 8 && !isNaN(cleanBarcode.split('*')[0].split('#')[0].slice(-8));

        if (!isShortcode && !isLegacySystemBarcode) {
            playError(); showToast('error', "Barcode ditolak! Harus dari label cetak sistem.");
            return;
        }

        let matched;
        if (isShortcode) {
            const shortCode = cleanBarcode.substring(1, 5);
            matched = variantsRef.current.find(v => v.shortCode === shortCode);
        } else {
            const skuCandidate = parseGlobalSku(cleanBarcode);
            matched = variantsRef.current.find(v => v.sku === skuCandidate);
        }
        if (matched && matched.isActive) {
            setScannedItems(prev => {
                if (!isMasuk) {
                    const sysSisa = stockRef.current[cleanBarcode] || 0;
                    const draftCount = prev.filter(i => i.fullBarcode === cleanBarcode).length;
                    if (sysSisa - draftCount <= 0) {
                        playError(); showToast('error', `Stok habis! Sisa batch ini: ${sysSisa}`);
                        return prev;
                    }
                }

                playSuccess();

                const newItem = {
                    id: 'T' + Date.now() + Math.random().toString(36).substr(2, 5),
                    sku: matched.sku, fullBarcode: cleanBarcode,
                    variantInfo: {
                        article: matched.article, colorName: matched.colorName, sizeName: matched.sizeName
                    },
                    type: type, qty: 1, date: new Date().toISOString(), category: kategoriScan
                };

                const newState = [newItem, ...prev];
                scannedItemsRef.current = newState;
                return newState;
            });
        } else {
            playError(); showToast('error', "Barang tidak ditemukan di database!");
        }
    };

    useEffect(() => {
        let scanner = null;
        if (showCamera) {
            const initScanner = () => {
                if (!window.Html5QrcodeScanner) return;
                scanner = new window.Html5QrcodeScanner('reader', { fps: 10, qrbox: { width: 250, height: 250 } }, false);
                scanner.render((text) => {
                    const now = Date.now();
                    if (lastScanRef.current.text === text && now - lastScanRef.current.time < 2000) return;
                    lastScanRef.current = { text, time: now };

                    processBarcode(text);
                }, (err) => { });
            };
            if (!window.Html5QrcodeScanner) {
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/html5-qrcode';
                script.onload = initScanner;
                document.head.appendChild(script);
            } else initScanner();
        }
        return () => { if (scanner) scanner.clear().catch(e => console.log(e)); };
    }, [showCamera]);

    const handleSimpanDraft = () => {
        const dataTerbaru = scannedItemsRef.current;
        if (dataTerbaru.length === 0) return showToast('error', 'Belum ada data scan untuk disimpan.');
        try {
            localStorage.setItem(draftKey, JSON.stringify(dataTerbaru));
            playConfirm();
            showToast('success', `Aman! ${dataTerbaru.length} item tersimpan ke Draft.`);
        } catch (e) { showToast('error', 'Gagal menyimpan! Memori Browser Penuh.'); }
        if (inputRef.current) inputRef.current.focus();
    };

    const handleConfirm = async () => {
        const dataTerbaru = scannedItemsRef.current;
        if (dataTerbaru.length === 0) return;
        if (!confirm(`Terdapat ${dataTerbaru.length} item untuk disimpan. Lanjutkan Konfirmasi?`)) return;

        setIsLoading(true);
        try {
            const batchId = 'B-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
            const operatorName = currentUser?.nama || currentUser?.username || 'Gudang';

            const poUpdates = {};
            if (isMasuk) {
                dataTerbaru.forEach(item => {
                    if (item.fullBarcode.includes('#')) {
                        const parts = item.fullBarcode.split('#');
                        const poNumber = parts[1];
                        const poId = 'PO' + poNumber;
                        const sku = parts[0].length > 8 ? parts[0].slice(0, -8) : parts[0];
                        if (!poUpdates[poId]) poUpdates[poId] = {};
                        poUpdates[poId][sku] = (poUpdates[poId][sku] || 0) + item.qty;
                    }
                });
            }

            const batch = db.batch();
            dataTerbaru.forEach(item => {
                const tData = {
                    id: item.id, sku: item.sku, fullBarcode: item.fullBarcode,
                    type: item.type, qty: item.qty, date: item.date, category: item.category || (isMasuk ? 'PO Nota' : 'Penjualan (Off + Online)'),
                    batchId: batchId, user: operatorName
                };
                const tRef = db.collection('transactions').doc(item.id);
                batch.set(tRef, tData);
            });

            // Update dokumen PO secara sequential sebelum commit
            for (const poId of Object.keys(poUpdates)) {
                const poRef = db.collection('purchase_orders').doc(poId);
                const poDoc = await poRef.get();
                if (poDoc.exists) {
                    const poData = poDoc.data();
                    let allReceived = true;
                    const newItems = poData.items.map(pit => {
                        const receivedQty = poUpdates[poId][pit.sku] || 0;
                        const newReceived = (pit.received || 0) + receivedQty;
                        if (newReceived < pit.qty) allReceived = false;
                        return { ...pit, received: newReceived };
                    });
                    batch.update(poRef, {
                        items: newItems,
                        status: allReceived ? 'ARRIVED' : 'OPEN',
                        updatedAt: new Date().toISOString()
                    });
                }
            }

            await batch.commit();
            setScannedItems([]); scannedItemsRef.current = []; localStorage.removeItem(draftKey);
            playConfirm(); showToast('success', `Berhasil menyimpan ${dataTerbaru.length} transaksi!`);
        } catch (err) { showToast('error', 'Gagal simpan: ' + err.message); }
        setIsLoading(false);
        if (inputRef.current) inputRef.current.focus();
    };

    const hapusItem = (id) => {
        setScannedItems(prev => {
            const newState = prev.filter(i => i.id !== id);
            scannedItemsRef.current = newState; return newState;
        });
    };

    return (
        <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-3xl border border-slate-200 shadow-xl relative">
            {showCamera && (
                <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
                    <div className="bg-white p-6 rounded-2xl w-full max-w-md shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-xl flex items-center gap-2"><i className="fa-solid fa-camera text-orange-500"></i> Scan Kamera</h3>
                            <button type="button" onClick={() => setShowCamera(false)} className="bg-red-50 text-red-600 p-2 rounded-full"><i className="fa-solid fa-xmark text-xl"></i></button>
                        </div>
                        <div id="reader" className="w-full rounded-xl overflow-hidden border-2 border-slate-300"></div>
                    </div>
                </div>
            )}

            <div className={`flex justify-between items-center text-white p-4 md:p-6 rounded-2xl shadow-inner mb-6 ${isMasuk ? 'bg-slate-800' : 'bg-slate-800'}`}>
                <div>
                    <h2 className="text-2xl md:text-3xl font-black flex items-center gap-3">
                        <i className={`fa-solid ${isMasuk ? 'fa-right-to-bracket text-teal-400' : 'fa-right-from-bracket text-red-400'}`}></i>
                        Scan {isMasuk ? 'Masuk' : 'Keluar'}
                    </h2>
                    <p className="text-slate-400 text-xs md:text-sm mt-2 font-bold tracking-widest uppercase">Total Item Belum Disimpan</p>
                </div>
                <div className={`text-4xl md:text-6xl font-black ${isMasuk ? 'text-teal-400' : 'text-red-400'}`}>{scannedItems.length}</div>
            </div>

            <div className="flex flex-col gap-3 mb-5 border-b-4 border-slate-100 pb-5">
                <button type="button" onClick={handleConfirm} disabled={scannedItems.length === 0} className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black text-base md:text-lg flex justify-center items-center gap-3 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed shadow-md transition-transform transform hover:-translate-y-0.5">
                    <i className="fa-solid fa-cloud-arrow-up text-xl"></i> KONFIRMASI &amp; SIMPAN
                </button>
                <div className="flex gap-3">
                    <button type="button" onClick={handleSimpanDraft} disabled={scannedItems.length === 0} className="flex-1 py-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl font-bold flex justify-center items-center gap-2 disabled:bg-slate-300 disabled:text-slate-500 transition-colors shadow-sm">
                        <i className="fa-solid fa-mug-hot"></i> Jeda &amp; Draft
                    </button>
                    <button type="button" onClick={() => { if (confirm('Hapus semua antrean scan yang belum tersimpan?')) { setScannedItems([]); scannedItemsRef.current = []; localStorage.removeItem(draftKey); } }} disabled={scannedItems.length === 0} className="flex-1 py-3 bg-rose-50 hover:bg-rose-100 text-rose-600 border-2 border-rose-200 rounded-xl font-bold flex justify-center items-center gap-2 disabled:border-slate-200 disabled:text-slate-400 transition-colors">
                        <i className="fa-solid fa-rotate-left"></i> Ulang Awal
                    </button>
                </div>
            </div>

            <div className="mb-4">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider block mb-1">Pilih Kategori Scan {isMasuk ? 'Masuk' : 'Keluar'}</label>
                <select value={kategoriScan} onChange={e => setKategoriScan(e.target.value)} className="w-full p-3 border-2 border-slate-200 rounded-xl font-bold bg-white outline-none focus:border-slate-400">
                    {isMasuk ? (
                        <>
                            <option value="PO Nota">PO Nota</option>
                            <option value="Resize">Tukar (Resize)</option>
                            <option value="Retur">Retur</option>
                            <option value="Repair">Repair</option>
                        </>
                    ) : (
                        <>
                            <option value="Penjualan (Off + Online)">Penjualan (Off + Online)</option>
                            <option value="Lainnya">Lainnya</option>
                        </>
                    )}
                </select>
            </div>

            <div className="mb-6">
                <div className="text-center font-bold text-rose-500 mb-3 text-sm bg-rose-50 p-2 rounded-lg border border-rose-200 inline-block w-full">
                    <i className="fa-solid fa-triangle-exclamation mr-1"></i> Jika ingin istirahat atau pindah menu, <b>WAJIB</b> klik tombol kuning <b>"Jeda & Draft"</b> agar data tidak hilang.
                </div>

                <div className="flex gap-4 mt-2">
                    <div className="relative flex-1">
                        <i className="fa-solid fa-barcode absolute left-6 top-5 text-slate-400 text-2xl"></i>
                        <input
                            ref={inputRef}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (inputRef.current && inputRef.current.value) {
                                        const val = inputRef.current.value; inputRef.current.value = ''; processBarcode(val);
                                    }
                                }
                            }}
                            className="w-full pl-16 pr-6 py-5 text-2xl md:text-3xl border-4 border-slate-300 focus:border-orange-500 rounded-2xl font-mono tracking-widest outline-none bg-slate-50 focus:bg-white transition-colors shadow-inner"
                            placeholder="KODE..."
                        />
                    </div>
                    <button type="button" onClick={() => setShowCamera(true)} className="bg-slate-800 hover:bg-slate-900 text-white px-6 md:px-8 rounded-2xl flex flex-col items-center justify-center font-bold text-sm shadow-xl transition-transform transform hover:-translate-y-1 border-b-4 border-slate-950">
                        <i className="fa-solid fa-camera text-3xl mb-1 text-orange-400"></i> Kamera
                    </button>
                </div>

            </div>

            <div>
                <h3 className="font-black text-lg text-slate-800 mb-4 flex items-center gap-2"><i className="fa-solid fa-list-ol text-orange-500"></i> 10 Barang Terakhir di-Scan</h3>
                <div className="max-h-[400px] overflow-y-auto space-y-3 pr-2 custom-scrollbar bg-slate-100 p-4 rounded-3xl border-2 border-slate-200 shadow-inner">
                    {scannedItems.slice(0, 10).map((item, idx) => (
                        <div key={item.id} className="flex items-center justify-between p-4 md:p-5 border-2 border-slate-200 rounded-2xl bg-white shadow-sm animate-in slide-in-from-left-4">
                            <div className="flex items-center gap-4 md:gap-5">
                                <span className="text-slate-300 font-black text-2xl w-8 text-right">{scannedItems.length - idx}.</span>
                                <div>
                                    <div className="font-black text-slate-900 text-base md:text-lg">{item.variantInfo.article}</div>
                                    <div className="text-xs md:text-sm font-bold text-slate-600 mt-1">{item.variantInfo.colorName} - Sz: <span className="text-orange-500 text-base">{item.variantInfo.sizeName}</span></div>
                                    <div className="text-[10px] md:text-[11px] text-slate-500 font-mono mt-2 bg-slate-100 px-2 py-1 rounded-md inline-block border border-slate-200">ID: {item.fullBarcode}</div>
                                </div>
                            </div>
                            <button type="button" onClick={() => hapusItem(item.id)} className="text-rose-500 bg-rose-50 hover:bg-rose-500 hover:text-white w-12 h-12 rounded-xl transition-colors flex items-center justify-center border border-rose-100"><i className="fa-solid fa-xmark text-xl font-black"></i></button>
                        </div>
                    ))}
                    {scannedItems.length > 10 && (
                        <div className="text-center py-4 text-slate-500 font-bold bg-white rounded-2xl border border-dashed border-slate-300">
                            + {scannedItems.length - 10} item disembunyikan
                        </div>
                    )}
                    {scannedItems.length === 0 && <div className="py-16 flex flex-col items-center justify-center text-slate-400"><i className="fa-solid fa-box-open text-6xl mb-4 opacity-50"></i><span className="font-bold text-lg">Belum ada barang di-scan</span></div>}
                </div>
            </div>
        </div>
    );
}

// 8. Stok Opname (Kode Sama Percis)
function StokOpname({ variants, transactions, setIsLoading, showToast, currentUser }) {
    const [step, setStep] = useState(1);
    const [showCamera, setShowCamera] = useState(false);
    const [comparisonResult, setComparisonResult] = useState(null);
    const inputRef = useRef(null);
    const lastScanRef = useRef({ text: '', time: 0 }); // TAMBAHAN UNTUK KAMERA CONTINUOUS

    const [scannedItems, setScannedItems] = useState(() => {
        try {
            const savedDraft = localStorage.getItem('opname_manual_draft');
            if (savedDraft) return JSON.parse(savedDraft);
        } catch (e) { }
        return [];
    });
    const scannedItemsRef = useRef(scannedItems);
    const variantsRef = useRef(variants);
    useEffect(() => { variantsRef.current = variants; }, [variants]);

    const processBarcode = (scannedText) => {
        const cleanBarcode = scannedText.trim().toUpperCase();
        if (!cleanBarcode) return;

        const isShortcode = cleanBarcode.startsWith('$');
        const isLegacySystemBarcode = cleanBarcode.length > 8 && !isNaN(cleanBarcode.split('*')[0].split('#')[0].slice(-8));

        if (!isShortcode && !isLegacySystemBarcode) {
            playError(); showToast('error', "Hanya menerima barcode dari sistem!");
            return;
        }

        let matched;
        if (isShortcode) {
            const shortCode = cleanBarcode.substring(1, 5);
            matched = variantsRef.current.find(v => v.shortCode === shortCode);
        } else {
            const skuCandidate = parseGlobalSku(cleanBarcode);
            matched = variantsRef.current.find(v => v.sku === skuCandidate);
        }
        if (matched && matched.isActive) {
            playSuccess();
            setScannedItems(prev => {
                const newItem = { id: 'SO' + Date.now() + Math.random().toString(36).substr(2, 5), sku: matched.sku, fullBarcode: cleanBarcode, variantInfo: { article: matched.article, colorName: matched.colorName, sizeName: matched.sizeName } };
                const newState = [newItem, ...prev]; scannedItemsRef.current = newState; return newState;
            });
        } else { playError(); showToast('error', "Barang tidak ditemukan di master data!"); }
    };

    useEffect(() => {
        let scanner = null;
        if (showCamera && step === 1) {
            const initScanner = () => {
                if (!window.Html5QrcodeScanner) return;
                scanner = new window.Html5QrcodeScanner('reader-opname', { fps: 10, qrbox: { width: 250, height: 250 } }, false);
                scanner.render((text) => {
                    const now = Date.now();
                    // Mencegah scan barcode yang SAMA PERSIS dalam rentang 2 detik
                    if (lastScanRef.current.text === text && now - lastScanRef.current.time < 2000) return;
                    lastScanRef.current = { text, time: now };

                    // Proses scan tanpa mematikan kamera
                    processBarcode(text);
                }, (err) => { });
            };
            if (!window.Html5QrcodeScanner) {
                const script = document.createElement('script'); script.src = 'https://unpkg.com/html5-qrcode'; script.onload = initScanner; document.head.appendChild(script);
            } else initScanner();
        }
        return () => { if (scanner) scanner.clear().catch(e => console.log(e)); };
    }, [showCamera, step]);

    const handleSimpanDraft = () => {
        const dataTerbaru = scannedItemsRef.current;
        if (dataTerbaru.length === 0) return showToast('error', 'Belum ada data scan.');
        try { localStorage.setItem('opname_manual_draft', JSON.stringify(dataTerbaru)); playConfirm(); showToast('success', `Aman! tersimpan ke Draft.`); } catch (e) { showToast('error', 'Gagal menyimpan!'); }
        if (inputRef.current) inputRef.current.focus();
    };

    const hapusItem = (id) => {
        setScannedItems(prev => { const newState = prev.filter(i => i.id !== id); scannedItemsRef.current = newState; return newState; });
    };

    const handleEvaluate = () => {
        setIsLoading(true); const dataTerbaru = scannedItemsRef.current;
        setTimeout(() => {
            const sysStock = {};
            transactions.forEach(t => {
                if (!t.fullBarcode) return;
                if (!sysStock[t.fullBarcode]) sysStock[t.fullBarcode] = 0;
                if (t.type === 'IN' || t.type === 'REVISI_IN') sysStock[t.fullBarcode] += t.qty;
                if (t.type === 'OUT' || t.type === 'REVISI_OUT') sysStock[t.fullBarcode] -= t.qty;
            });
            const scanStock = {};
            dataTerbaru.forEach(item => {
                if (!scanStock[item.fullBarcode]) scanStock[item.fullBarcode] = 0;
                scanStock[item.fullBarcode] += 1;
            });

            const result = [];
            const allKeys = new Set([...Object.keys(sysStock), ...Object.keys(scanStock)]);
            allKeys.forEach(bc => {
                const sysQty = sysStock[bc] || 0; const scanQty = scanStock[bc] || 0;
                if (sysQty === 0 && scanQty === 0) return;
                const diff = scanQty - sysQty;

                const skuCandidate = parseGlobalSku(bc, variants);

                const variant = variants.find(v => v.sku === skuCandidate);
                result.push({ fullBarcode: bc, variant, sysQty, scanQty, diff });
            });
            result.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || (a.variant?.article || '').localeCompare(b.variant?.article || ''));
            setComparisonResult(result); setIsLoading(false); setStep(2);
        }, 100);
    };

    const differences = comparisonResult ? comparisonResult.filter(c => c.diff !== 0) : [];
    const totalSystem = comparisonResult ? comparisonResult.reduce((acc, curr) => acc + curr.sysQty, 0) : 0;
    const totalScanned = comparisonResult ? comparisonResult.reduce((acc, curr) => acc + curr.scanQty, 0) : 0;
    const totalDiffAbsolute = comparisonResult ? differences.reduce((acc, curr) => acc + Math.abs(curr.diff), 0) : 0;

    const downloadExcel = () => {
        if (!comparisonResult || typeof XLSX === 'undefined') return showToast('error', "Tunggu sebentar.");
        const wb = XLSX.utils.book_new();
        const headers = ["Article", "Warna", "Size", "Barcode Batch", "Stok Server (Sistem)", "Stok Aktual (Fisik)", "Selisih"];
        const sheetData = [headers];
        const sortedDiffItems = [...differences].sort((a, b) => {
            const artA = a.variant?.article || ''; const artB = b.variant?.article || '';
            if (artA !== artB) return artA.localeCompare(artB);
            const colA = a.variant?.colorName || ''; const colB = b.variant?.colorName || '';
            if (colA !== colB) return colA.localeCompare(colB);
            const szA = a.variant?.sizeName || ''; const szB = b.variant?.sizeName || '';
            return szA.localeCompare(szB, undefined, { numeric: true });
        });
        let lastArticle = "";
        sortedDiffItems.forEach(item => {
            const currentArticle = item.variant?.article || 'PRODUK DIHAPUS';
            const displayArticle = currentArticle === lastArticle ? "" : currentArticle; lastArticle = currentArticle;
            sheetData.push([displayArticle, item.variant?.colorName || '-', item.variant?.sizeName || '-', item.fullBarcode, item.sysQty, item.scanQty, item.diff]);
        });
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        XLSX.utils.book_append_sheet(wb, ws, "Barang Bermasalah");
        XLSX.writeFile(wb, `Audit_Stok_Bermasalah_${new Date().toLocaleDateString('id-ID').replace(/\//g, '-')}.xlsx`);
    };

    const handleAdjustStock = async () => {
        if (differences.length === 0) {
            showToast('success', 'Stok akurat 100%!'); setStep(1); setScannedItems([]); scannedItemsRef.current = []; localStorage.removeItem('opname_manual_draft'); setComparisonResult(null); return;
        }
        if (!confirm(`Sesuaikan ${differences.length} batch barang?`)) return;
        setIsLoading(true);
        try {
            const batchId = 'SO' + Date.now();
            const operatorName = currentUser.nama || currentUser.username || 'Admin';

            const batch = db.batch();
            differences.forEach(c => {
                const type = c.diff > 0 ? 'IN' : 'OUT'; const qty = Math.abs(c.diff);
                const fallbackSku = parseGlobalSku(c.fullBarcode);

                const tData = {
                    id: 'SO' + Date.now() + Math.random().toString(36).substr(2, 5),
                    sku: c.variant ? c.variant.sku : fallbackSku,
                    fullBarcode: c.fullBarcode,
                    type: type,
                    qty: qty,
                    date: new Date().toISOString(),
                    batchId,
                    user: operatorName
                };
                const tRef = db.collection('transactions').doc(tData.id); batch.set(tRef, tData);
            });
            await batch.commit();
            playConfirm(); showToast('success', 'Penyesuaian stok berhasil!');
            setStep(1); setScannedItems([]); scannedItemsRef.current = []; localStorage.removeItem('opname_manual_draft'); setComparisonResult(null);
        } catch (err) { showToast('error', 'Gagal update: ' + err.message); }
        setIsLoading(false);
    };

    if (step === 1) {
        return (
            <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-3xl border-2 border-purple-200 shadow-xl relative">
                {showCamera && (
                    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
                        <div className="bg-white p-6 rounded-2xl w-full max-w-md shadow-2xl">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-xl flex items-center gap-2"><i className="fa-solid fa-camera text-purple-600"></i> Kamera Opname</h3>
                                <button type="button" onClick={() => setShowCamera(false)} className="bg-red-50 text-red-600 p-2 rounded-full"><i className="fa-solid fa-xmark text-xl"></i></button>
                            </div>
                            <div id="reader-opname" className="w-full rounded-xl overflow-hidden border-2 border-slate-300"></div>
                        </div>
                    </div>
                )}

                <div className="flex justify-between items-center bg-purple-900 text-white p-6 md:p-8 rounded-2xl shadow-inner mb-6 relative overflow-hidden">
                    <i className="fa-solid fa-cloud-arrow-down absolute -right-4 -bottom-4 text-purple-800 text-8xl opacity-40"></i>
                    <div className="relative z-10"><h2 className="text-2xl md:text-3xl font-black flex items-center gap-3"><i className="fa-solid fa-clipboard-check text-purple-400"></i> Stok Opname</h2><p className="text-purple-200 text-xs md:text-sm mt-2 font-bold tracking-widest uppercase">Total Scan Fisik Sementara</p></div>
                    <div className="text-6xl md:text-7xl font-black text-purple-300 relative z-10">{scannedItems.length}</div>
                </div>

                <div className="flex flex-col gap-3 mb-6 border-b-4 border-slate-100 pb-6">
                    <button type="button" onClick={handleEvaluate} disabled={scannedItems.length === 0} className="w-full py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white rounded-2xl font-black text-xl flex justify-center items-center gap-3 shadow-lg shadow-purple-500/30 transition-transform transform hover:-translate-y-1"><i className="fa-solid fa-magnifying-glass-chart text-2xl"></i> SELESAI SCAN & EVALUASI</button>
                    <div className="flex gap-3">
                        <button type="button" onClick={handleSimpanDraft} disabled={scannedItems.length === 0} className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white rounded-xl font-bold flex justify-center items-center gap-2 transition-colors shadow-sm"><i className="fa-solid fa-mug-hot"></i> Jeda & Draft</button>
                        <button type="button" onClick={() => { if (confirm('Hapus semua draft hasil scan opname saat ini?')) { setScannedItems([]); scannedItemsRef.current = []; localStorage.removeItem('opname_manual_draft'); } }} disabled={scannedItems.length === 0} className="flex-1 py-3 bg-rose-50 hover:bg-rose-100 disabled:border-slate-200 disabled:text-slate-400 text-rose-600 border-2 border-rose-200 rounded-xl font-bold flex justify-center items-center gap-2 transition-colors"><i className="fa-solid fa-rotate-left"></i> Ulang Awal</button>
                    </div>
                </div>

                <div className="mb-6">
                    <div className="flex gap-4 mt-2">
                        <div className="relative flex-1">
                            <i className="fa-solid fa-barcode absolute left-6 top-5 text-purple-400 text-2xl"></i>
                            <input ref={inputRef} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (inputRef.current && inputRef.current.value) { const val = inputRef.current.value; inputRef.current.value = ''; processBarcode(val); } } }} className="w-full pl-16 pr-6 py-5 text-2xl md:text-3xl border-4 border-purple-200 focus:border-purple-500 rounded-2xl font-mono tracking-widest outline-none bg-slate-50 focus:bg-white transition-colors shadow-inner" placeholder="KODE..." />
                        </div>
                        <button type="button" onClick={() => setShowCamera(true)} className="bg-slate-800 hover:bg-slate-900 text-white px-6 md:px-8 rounded-2xl flex flex-col items-center justify-center font-bold text-sm shadow-xl transition-transform transform hover:-translate-y-1 border-b-4 border-slate-950"><i className="fa-solid fa-camera text-3xl mb-1 text-purple-400"></i> Kamera</button>
                    </div>
                </div>

                <div>
                    <h3 className="font-black text-lg text-slate-800 mb-4 flex items-center gap-2"><i className="fa-solid fa-list-ol text-purple-500"></i> 10 Barang Terakhir di-Scan</h3>
                    <div className="max-h-[400px] overflow-y-auto space-y-3 pr-2 custom-scrollbar bg-slate-100 p-4 rounded-3xl border-2 border-slate-200 shadow-inner">
                        {scannedItems.slice(0, 10).map((item, idx) => (
                            <div key={item.id} className="flex items-center justify-between p-4 md:p-5 border-2 border-slate-200 rounded-2xl bg-white shadow-sm animate-in slide-in-from-left-4">
                                <div className="flex items-center gap-4 md:gap-5">
                                    <span className="text-slate-300 font-black text-2xl w-8 text-right">{scannedItems.length - idx}.</span>
                                    <div>
                                        <div className="font-black text-slate-900 text-base md:text-lg">{item.variantInfo.article}</div>
                                        <div className="text-xs md:text-sm font-bold text-slate-600 mt-1">{item.variantInfo.colorName} - Sz: <span className="text-orange-500 font-black">{item.variantInfo.sizeName}</span></div>
                                    </div>
                                </div>
                                <button type="button" onClick={() => hapusItem(item.id)} className="text-rose-500 bg-rose-50 hover:bg-rose-500 hover:text-white w-12 h-12 rounded-xl transition-colors flex items-center justify-center border border-rose-100"><i className="fa-solid fa-xmark text-xl font-black"></i></button>
                            </div>
                        ))}
                        {scannedItems.length === 0 && <div className="py-16 flex flex-col items-center justify-center text-slate-400"><i className="fa-solid fa-box-open text-6xl mb-4 opacity-50"></i><span className="font-bold text-lg">Mulai scan barang fisik di gudang.</span></div>}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border shadow-sm">
                <button type="button" onClick={() => setStep(1)} className="w-full md:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-3 rounded-xl font-bold transition-colors"><i className="fa-solid fa-arrow-left mr-2"></i> Lanjutkan Scan Fisik</button>
                <div className="flex gap-3 w-full md:w-auto">
                    <button type="button" onClick={downloadExcel} className="flex-1 md:flex-none bg-emerald-100 hover:bg-emerald-600 hover:text-white text-emerald-700 px-6 py-3 rounded-xl font-bold transition-colors shadow-sm"><i className="fa-solid fa-file-excel mr-2"></i> Excel Bermasalah</button>
                    <button type="button" onClick={handleAdjustStock} className="flex-1 md:flex-none bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-purple-500/30 transition-transform transform hover:-translate-y-1">SESUAIKAN STOK SEKARANG</button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900 text-white p-6 rounded-3xl border-4 border-slate-800 shadow-xl text-center"><p className="text-slate-400 font-bold text-sm uppercase tracking-wider mb-2">Total di Sistem Server</p><div className="text-5xl font-black">{totalSystem}</div></div>
                <div className="bg-orange-500 text-white p-6 rounded-3xl border-4 border-orange-500 shadow-xl text-center"><p className="text-blue-200 font-bold text-sm uppercase tracking-wider mb-2">Total Scan Fisik</p><div className="text-5xl font-black">{totalScanned}</div></div>
                <div className={`p-6 rounded-3xl border-4 shadow-xl text-center ${totalDiffAbsolute === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}><p className="font-bold text-sm uppercase tracking-wider mb-2">Item Bermasalah (Selisih)</p><div className="text-5xl font-black">{totalDiffAbsolute}</div></div>
            </div>

            <div className="bg-white rounded-3xl border shadow-lg overflow-hidden">
                <div className="p-6 border-b bg-slate-50"><h3 className="font-black text-xl text-slate-800"><i className="fa-solid fa-scale-unbalanced text-purple-500 mr-2"></i> Laporan Selisih Stok per Batch</h3></div>
                <div className="overflow-x-auto custom-scrollbar max-h-[600px]">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-slate-100 text-slate-700 border-b-4 border-slate-200 sticky top-0 z-10 whitespace-nowrap">
                            <tr><th className="p-5 font-black uppercase">Detail Produk</th><th className="p-5 font-black uppercase text-center border-x border-slate-200">Barcode Batch</th><th className="p-5 font-black uppercase text-center bg-slate-200/50">Stok Sistem</th><th className="p-5 font-black uppercase text-center bg-orange-50">Stok Scan Fisik</th><th className="p-5 font-black uppercase text-center border-l border-slate-200">Selisih</th></tr>
                        </thead>
                        <tbody>
                            {comparisonResult && comparisonResult.map((c, i) => {
                                const isDiff = c.diff !== 0;
                                return (
                                    <tr key={i} className={`border-b border-slate-100 transition-colors whitespace-nowrap ${isDiff ? (c.diff > 0 ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'bg-rose-50/40 hover:bg-rose-50') : 'hover:bg-slate-50'}`}>
                                        <td className="p-5"><div className="font-black text-slate-800 text-base">{c.variant?.article || 'PRODUK DIHAPUS'}</div><div className="text-xs font-bold text-slate-500 mt-1">{c.variant?.colorName || '-'} - Sz: <span className="text-orange-500 font-black">{c.variant?.sizeName || '-'}</span></div></td>
                                        <td className="p-5 text-center font-mono text-xs text-slate-500 border-x border-slate-100">{c.fullBarcode}</td>
                                        <td className="p-5 text-center font-bold text-slate-600 bg-slate-50/50 text-lg">{c.sysQty}</td>
                                        <td className="p-5 text-center font-black text-orange-600 bg-orange-50/30 text-lg">{c.scanQty}</td>
                                        <td className="p-5 text-center border-l border-slate-100">{c.diff === 0 ? <span className="text-slate-300 font-black"><i className="fa-solid fa-check"></i> Pas</span> : c.diff > 0 ? <span className="text-emerald-600 font-black bg-emerald-100 px-3 py-1.5 rounded-lg">+ {c.diff} (Lebih)</span> : <span className="text-rose-600 font-black bg-rose-100 px-3 py-1.5 rounded-lg">{c.diff} (Hilang)</span>}</td>
                                    </tr>
                                );
                            })}
                            {(!comparisonResult || comparisonResult.length === 0) && <tr><td colSpan="5" className="p-12 text-center text-slate-400 font-bold">Data kosong.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// 4. Cetak Label Massal & Pratinjau (Kode Sama Percis)
function CetakLabel({ products, variants, showToast }) {
    const [printList, setPrintList] = useState([]);
    const [printDate, setPrintDate] = useState(new Date().toISOString().split('T')[0]);
    const [searchQuery, setSearchQuery] = useState('');
    const [qtys, setQtys] = useState({});

    const getProductionCode = (dateString) => {
        if (!dateString) return "";
        const parts = dateString.split('T')[0].split('-');
        if (parts.length !== 3) return "";
        const y = parts[0].slice(-2);
        const m = parseInt(parts[1], 10).toString();
        const mapChar = (char) => {
            const map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', '6': 'F', '7': 'G', '8': 'H', '9': 'I', '0': 'J' };
            return map[char] || char;
        };
        const encodedYear = y.split('').map(mapChar).join('');
        const encodedMonth = m.split('').map(mapChar).join('');
        return `${encodedYear}-${encodedMonth}`;
    };

    const addToPrint = (variant) => {
        const qty = qtys[variant.sku] || 1;
        const itemsToAdd = Array.from({ length: qty }).map(() => ({ ...variant, printDate, _id: Math.random() }));
        setPrintList([...printList, ...itemsToAdd]);
        showToast('success', `${qty} label ditambahkan ke antrean.`);
    };

    const removePrint = (idx) => {
        const newList = [...printList]; newList.splice(idx, 1); setPrintList(newList);
    };

    const executePrint = () => {
        if (printList.length === 0) return showToast('error', "Daftar cetak kosong");

        // ---- Kumpulkan SEMUA label ke array terlebih dahulu ----
        const BATCH_SIZE = 80;
        const allLabelHtmls = [];

        printList.forEach(item => {
            const fullBarcode = buildShortBarcode(item, item.printDate, 'STANDARD', '');
            const prodCode = getProductionCode(item.printDate);
            const priceStr = "Rp. " + Number(item.sellPrice || 0).toLocaleString('id-ID');

            allLabelHtmls.push(`
              <div class="label-container">
                <div class="label-grid">
                  <div class="cell br bb">${item.photo ? `<img class="photo" src="${item.photo}" />` : `<div style="font-size:10px;">No Img</div>`}</div>
                  <div class="cell br bb" style="flex-direction: column;"><svg class="barcode-svg" jsbarcode-value="${fullBarcode}" jsbarcode-format="CODE128" jsbarcode-width="2" jsbarcode-height="55" jsbarcode-displayvalue="false" jsbarcode-margin="0" jsbarcode-fontsize="14"></svg></div>
                  <div class="cell bb"><div class="prod-code">${prodCode}</div></div>
                  <div class="cell br" style="flex-direction: column;"><div class="size-text">${item.sizeName}</div><div class="color-text">${item.colorName}</div></div>
                  <div class="cell br" style="flex-direction: column;"><div class="article-text">${item.article}</div><div class="price-text">${priceStr}</div></div>
                  <div class="cell"><div class="qrcode-target" data-value="${fullBarcode}"></div></div>
                </div>
              </div>
            `);
        });

        // ---- CSS & Script yang sama untuk tiap window ----
        const pageStyle = `
            <!DOCTYPE html><html><head>
              <title>Cetak Label Barcode</title>
              <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
              <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
              <style>
                @page { margin: 0; }
                body { margin: 0; padding: 0; font-family: sans-serif; background-color: white; }
                .label-container { width: 471px; height: 215px; margin: 5px; padding: 0; border: none; box-sizing: border-box; page-break-after: always; page-break-inside: avoid; overflow: hidden; background-color: white; display: flex; justify-content: center; align-items: center; }
                .label-grid { width: 100%; height: 100%; border: 2px solid black; display: grid; grid-template-columns: 1.4fr 2.4fr 0.9fr; grid-template-rows: 1fr 1fr; box-sizing: border-box; position: relative; }
                .cell { display: flex; justify-content: center; align-items: center; padding: 5px; box-sizing: border-box; text-align: center; overflow: hidden; }
                .br { border-right: 1px solid black; }
                .bb { border-bottom: 1px solid black; }
                .photo { max-width: 100%; max-height: 100%; object-fit: contain; }
                .barcode-svg { max-width: 100%; max-height: 100%; }
                .size-text { font-size: 48px; font-weight: 900; line-height: 1; }
                .color-text { font-size: 18px; font-weight: bold; text-transform: uppercase; margin-top: 4px; }
                .prod-code { font-size: 36px; font-weight: 900; letter-spacing: 2px; }
                .article-text { font-size: 20px; font-weight: 900; }
                .price-text { font-size: 14px; font-weight: 900; color: #222; margin-top: 4px; border: 1.5px solid #666; padding: 2px 8px; border-radius: 4px; }
              </style>
            </head><body>`;

        const pageScript = `
              <script>
                window.onload = function() {
                  if(window.JsBarcode) { JsBarcode(".barcode-svg").init(); }
                  if(window.QRCode) {
                     var qrcodes = document.querySelectorAll('.qrcode-target');
                     qrcodes.forEach(function(el) { new QRCode(el, { text: el.getAttribute('data-value'), width: 70, height: 70, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L }); });
                  }
                };
              <\/script>
            </body></html>`;

        // ---- Buka 1 tab per batch (maks BATCH_SIZE label) ----
        const totalBatches = Math.ceil(allLabelHtmls.length / BATCH_SIZE);
        for (let b = 0; b < totalBatches; b++) {
            const chunk = allLabelHtmls.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
            setTimeout(() => {
                const win = window.open('', '_blank');
                if (!win) { showToast('error', "Gagal membuka tab baru. Izinkan Pop-up Blocker!"); return; }
                win.document.open();
                win.document.write(pageStyle + chunk.join('') + pageScript);
                win.document.close();
            }, b * 400);
        }

        if (totalBatches > 1) {
            showToast('success', `${allLabelHtmls.length} label dibagi menjadi ${totalBatches} tab cetak (maks 80/tab).`);
        }
    };

    const safeLower = (str) => (str || '').toString().toLowerCase();
    const query = (searchQuery || '').toLowerCase().trim();
    const filteredVariants = variants.filter(v => {
        if (!v.isActive) return false;
        if (!query) return false;

        // LOGIKA BARU: Jika user scan barcode / mengetik murni angka 8 digit atau lebih
        if (/^\d{8,}$/.test(query)) {
            return safeLower(v.sku) === query || safeLower(v.baseCode) === query;
        }

        // Logika pencarian multi-kata (seperti "Hitam 36" atau "F07")
        const words = query.split(/\s+/);
        return words.every(word => {
            return safeLower(v.article).includes(word) ||
                safeLower(v.colorName).includes(word) ||
                safeLower(v.sizeName).includes(word) ||
                safeLower(v.sku).includes(word) ||
                safeLower(v.baseCode).includes(word);
        });
    });

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 no-print">
                <div className="bg-white p-8 rounded-3xl border shadow-sm flex flex-col h-[650px]">
                    <h3 className="text-2xl font-black mb-6 flex items-center gap-3 text-slate-800 border-b-2 border-slate-100 pb-4"><i className="fa-solid fa-tags text-orange-500 bg-orange-50 p-3 rounded-xl"></i> Cari Produk</h3>
                    <div className="space-y-4 mb-4">
                        <div>
                            <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Tanggal Cetak Barcode</label>
                            <input type="date" className="w-full p-4 border-2 border-slate-300 rounded-xl mt-1.5 font-bold text-slate-800 outline-none focus:border-orange-500 bg-slate-50" value={printDate} onChange={e => setPrintDate(e.target.value)} />
                        </div>
                        <div className="relative">
                            <i className="fa-solid fa-search absolute left-5 top-4 text-slate-400 text-lg"></i>
                            <input type="text" placeholder="Ketik Article, Warna, Size..." className="w-full pl-14 pr-4 py-4 border-2 border-slate-300 rounded-xl text-base outline-none focus:border-orange-500 bg-slate-50 font-bold" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto border-2 border-slate-200 rounded-2xl bg-slate-50 p-2 space-y-2 shadow-inner custom-scrollbar">
                        {filteredVariants.map(v => (
                            <div key={v.sku} className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-white border-2 border-transparent rounded-xl shadow-sm hover:border-orange-400 transition-colors gap-4">
                                <div className="flex items-center gap-4">
                                    <img src={v.photo} className="w-14 h-14 object-cover rounded-xl border shadow-sm" />
                                    <div><div className="text-base font-black text-slate-800">{v.article} <span className="text-xs text-orange-500 bg-orange-100 px-2 py-0.5 rounded-md font-bold ml-2 tracking-wider">SKU: {v.sku}</span> {v.baseCode ? <span className="text-[10px] text-slate-400 ml-1">(Base: {v.baseCode})</span> : ''}</div><div className="text-xs font-bold text-slate-500 mt-1">{v.colorName} &bull; Size: <span className="text-orange-500 text-sm font-black">{v.sizeName}</span></div></div>
                                </div>
                                <div className="flex items-center gap-2 w-full md:w-auto">
                                    <input type="number" min="1" placeholder="Qty" value={qtys[v.sku] || 1} onChange={e => setQtys({ ...qtys, [v.sku]: parseInt(e.target.value) || 1 })} className="w-16 px-2 py-3 border-2 border-slate-300 rounded-lg text-center font-bold text-sm outline-none focus:border-orange-500 bg-slate-50" />
                                    <button type="button" onClick={() => addToPrint(v)} className="flex-1 md:flex-none bg-orange-100 text-orange-600 hover:bg-orange-500 hover:text-white transition-colors px-4 py-3 rounded-xl font-black text-xs whitespace-nowrap"><i className="fa-solid fa-plus mr-1"></i> CETAK</button>
                                </div>
                            </div>
                        ))}
                        {filteredVariants.length === 0 && (
                            <div className="text-center text-sm font-bold text-slate-500 py-10">
                                <i className="fa-solid fa-box-open text-4xl mb-3 text-slate-300 block"></i>
                                {!query ? 'Ketik nama, warna, size, atau scan barcode untuk mencari...' : 'Produk tidak ditemukan. Cek kembali kata kunci Anda.'}
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl flex flex-col h-[650px] relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5 text-slate-400"><i className="fa-solid fa-print text-8xl"></i></div>
                    <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4 relative z-10">
                        <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><i className="fa-solid fa-list-check text-orange-500"></i> Antrean Label</h3>
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={() => setPrintList([])} disabled={printList.length === 0} className="bg-red-50 text-red-600 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 border border-red-200"><i className="fa-solid fa-trash-can mr-1"></i> Hapus Semua</button>
                            <span className="text-white font-black bg-orange-500 px-4 py-2 rounded-xl text-sm shadow-md">{printList.length} Item</span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 mb-6 bg-slate-50 rounded-2xl p-3 shadow-inner custom-scrollbar relative z-10 border border-slate-200">
                        {printList.map((item, idx) => (
                            <div key={item._id} className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 hover:border-orange-300 transition-colors shadow-sm">
                                <div className="text-sm text-slate-600 flex items-center gap-3">
                                    <span className="text-slate-400 font-bold w-4">{idx + 1}.</span>
                                    <span><span className="font-black text-slate-800 text-base">{item.article}</span> <span className="opacity-80 font-bold ml-1 text-slate-500">({item.colorName} - <b className="text-orange-500 text-base">{item.sizeName}</b>)</span></span>
                                </div>
                                <button type="button" onClick={() => removePrint(idx)} className="text-red-500 hover:text-white w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-red-500 rounded-xl transition-colors"><i className="fa-solid fa-xmark text-lg font-black"></i></button>
                            </div>
                        ))}
                        {printList.length === 0 && <div className="text-slate-400 font-medium text-sm text-center py-10">Pilih produk dari kolom di sebelah kiri</div>}
                    </div>
                    <button type="button" onClick={executePrint} disabled={printList.length === 0} className="w-full bg-orange-500 hover:bg-orange-600 text-white py-5 rounded-2xl font-black text-xl disabled:opacity-50 transition-transform transform hover:-translate-y-1 shadow-lg shadow-orange-500/30 relative z-10"><i className="fa-solid fa-print text-2xl mr-3"></i> CETAK LABEL SEKARANG</button>
                </div>
            </div>

            {/* Pratinjau Visual */}
            <div className="bg-white p-8 rounded-2xl border shadow-sm no-print">
                <h3 className="text-lg font-bold text-slate-800 mb-6 border-b pb-4 flex items-center gap-2">
                    <i className="fa-solid fa-magnifying-glass text-orange-500 bg-orange-50 p-2 rounded-lg"></i> Pratinjau Desain Stiker (471x215 px)
                </h3>
                {printList.length > 0 ? (
                    <div className="flex gap-6 overflow-x-auto pb-4 custom-scrollbar">
                        {printList.slice(0, 3).map((item, idx) => {
                            const fullBarcode = buildShortBarcode(item, item.printDate, 'STANDARD', '');
                            const prodCode = getProductionCode(item.printDate);
                            return (
                                <div key={idx} className="flex-shrink-0 shadow-xl" style={{ width: '471px', height: '215px', margin: '5px', padding: '0', backgroundColor: 'white', boxSizing: 'border-box', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                    <div style={{ position: 'relative', width: '100%', height: '100%', border: '2px solid black', display: 'grid', gridTemplateColumns: '1.4fr 2.4fr 0.9fr', gridTemplateRows: '1fr 1fr', boxSizing: 'border-box' }}>

                                        <div style={{ borderRight: '1px solid black', borderBottom: '1px solid black', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5px' }}>
                                            {item.photo ? <img src={item.photo} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: '10px' }}>No Img</span>}
                                        </div>
                                        <div style={{ borderRight: '1px solid black', borderBottom: '1px solid black', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '5px', overflow: 'hidden' }}>
                                            <Barcode value={fullBarcode} />
                                        </div>
                                        <div style={{ borderBottom: '1px solid black', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5px' }}>
                                            <div style={{ fontSize: '36px', fontWeight: '900', letterSpacing: '2px' }}>{prodCode}</div>
                                        </div>
                                        <div style={{ borderRight: '1px solid black', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '5px', textAlign: 'center' }}>
                                            <div style={{ fontSize: '48px', fontWeight: '900', lineHeight: '1' }}>{item.sizeName}</div>
                                            <div style={{ fontSize: '18px', fontWeight: 'bold', textTransform: 'uppercase', marginTop: '4px' }}>{item.colorName}</div>
                                        </div>
                                        <div style={{ borderRight: '1px solid black', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '5px', textAlign: 'center' }}>
                                            <div style={{ fontSize: '20px', fontWeight: '900' }}>{item.article}</div>
                                            <div style={{ fontSize: '14px', fontWeight: '900', color: '#222', marginTop: '4px', border: '1.5px solid #666', padding: '2px 8px', borderRadius: '4px' }}>Rp. {formatRp(item.sellPrice || 0).replace('Rp\xa0', '')}</div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5px' }}>
                                            <QRCodeLocal value={fullBarcode} />
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                        {printList.length > 3 && <div className="flex items-center justify-center px-8 bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 font-bold text-sm">
                            + {printList.length - 3} Label Lainnya...
                        </div>}
                    </div>
                ) : (
                    <p className="text-sm font-medium text-slate-500 py-6 text-center bg-slate-50 rounded-xl border border-dashed">Tambahkan produk ke antrean cetak untuk melihat pratinjau stiker.</p>
                )}
            </div>
        </div>
    );
}

// 5. Laporan Stok (Diperbarui untuk mengakomodasi Data Revisi)
function LaporanStok({ variants, transactions, products, currentUser, setIsLoading, showToast }) {
    const [showResetModal, setShowResetModal] = useState(false);
    const [resetPass, setResetPass] = useState('');

    const calculatedStock = variants.map(v => {
        const stock = transactions.filter(t => t.sku === v.sku).reduce((sum, t) => {
            if (t.type === 'IN' || t.type === 'REVISI_IN') return sum + t.qty;
            if (t.type === 'OUT' || t.type === 'REVISI_OUT') return sum - t.qty;
            return sum;
        }, 0);
        return { ...v, stock };
    });

    const totalPhysicalStock = calculatedStock.reduce((acc, curr) => acc + curr.stock, 0);
    const totalBuyValue = calculatedStock.reduce((acc, curr) => acc + (curr.stock * curr.buyPrice), 0);
    const totalSellValue = calculatedStock.reduce((acc, curr) => acc + (curr.stock * curr.sellPrice), 0);

    // Mengurutkan produk menggunakan logika Custom Faradela
    const sortedProducts = [...products].sort((a, b) => {
        const infoA = parseArticleForSortGlobal(a.article);
        const infoB = parseArticleForSortGlobal(b.article);

        // 1. Urutkan berdasarkan Awalan (2F01 akan otomatis di atas 3F01 dan F01)
        const prefixCmp = infoA.prefix.localeCompare(infoB.prefix, undefined, { numeric: true });
        if (prefixCmp !== 0) return prefixCmp;

        // 2. Urutkan berdasarkan Grup Titik (.1 akan di atas .2)
        if (infoA.group !== infoB.group) return infoA.group - infoB.group;

        // 3. Urutkan berdasarkan Nomor Artikel (04 akan di atas 05)
        return infoA.num - infoB.num;
    });
    const allSizeNames = Array.from(new Set(variants.map(v => v.sizeName))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const tableRows = [];
    sortedProducts.forEach(prod => {
        const colors = prod.colors || [];
        colors.forEach((color, idx) => {
            const sizesArray = calculatedStock.filter(v => v.productId === prod.id && v.colorCode === color.code);
            if (sizesArray.length > 0) {
                // LOGIKA BARU: Hitung total Beli & Jual spesifik dari tiap Size
                let rowTotalBeli = 0;
                let rowTotalJual = 0;
                sizesArray.forEach(sz => {
                    rowTotalBeli += (sz.stock * sz.buyPrice);
                    rowTotalJual += (sz.stock * sz.sellPrice);
                });

                tableRows.push({
                    article: prod.article, colorName: color.name, isFirstRow: idx === 0, rowSpan: colors.length,
                    buyPrice: prod.buyPrice || 0, sellPrice: prod.sellPrice || 0, sizes: sizesArray,
                    rowTotalBeli, rowTotalJual
                });
            }
        });
    });

    const downloadExcel = () => {
        if (typeof XLSX === 'undefined') return showToast('error', "Library Excel belum termuat sempurna, tunggu sebentar.");
        const tableData = [];
        const header = ["Article", "Warna", ...allSizeNames, "Total Qty", "Total Harga Beli", "Total Harga Jual"];
        tableData.push(header);

        tableRows.forEach(row => {
            const totalPerColor = row.sizes.reduce((acc, curr) => acc + curr.stock, 0);
            // Panggil hasil hitungan Size yang baru
            const totalBeli = row.rowTotalBeli;
            const totalJual = row.rowTotalJual;

            const excelRow = [];
            excelRow.push(row.isFirstRow ? row.article : "");
            excelRow.push(row.colorName);

            allSizeNames.forEach(sz => {
                const matchedSize = row.sizes.find(s => s.sizeName === sz);
                excelRow.push(matchedSize ? matchedSize.stock : 0);
            });

            excelRow.push(totalPerColor); excelRow.push(totalBeli); excelRow.push(totalJual); tableData.push(excelRow);
        });

        const ws = XLSX.utils.aoa_to_sheet(tableData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Laporan Stok");
        XLSX.writeFile(wb, `Laporan_Stok_${new Date().toLocaleDateString('id-ID').replace(/\//g, '-')}.xlsx`);
    };

    const handleResetStok = async (e) => {
        e.preventDefault();
        if (resetPass !== currentUser.password) { return showToast('error', "GAGAL: Password Salah!"); }
        if (confirm('TINDAKAN INI TIDAK BISA DIBATALKAN. Seluruh riwayat barang masuk & keluar akan dihapus, sehingga stok menjadi 0. Lanjutkan?')) {
            setIsLoading(true);
            try {
                const txDocs = await db.collection('transactions').get();
                
                const batches = [];
                let currentBatch = db.batch();
                let operationCounter = 0;

                txDocs.docs.forEach((doc) => {
                    currentBatch.delete(doc.ref);
                    operationCounter++;

                    if (operationCounter === 450) {
                        batches.push(currentBatch);
                        currentBatch = db.batch();
                        operationCounter = 0;
                    }
                });
                
                if (operationCounter > 0) {
                    batches.push(currentBatch);
                }

                for (const batch of batches) {
                    await batch.commit();
                }

                showToast('success', 'Semua data stok berhasil direset menjadi 0!'); setShowResetModal(false); setResetPass('');
            } catch (error) { showToast('error', "Gagal mereset stok: " + error.message); }
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6 relative">
            {showResetModal && (
                <div className="fixed inset-0 z-[100] bg-black/80 flex flex-col items-center justify-center p-4">
                    <div className="bg-white p-8 rounded-3xl w-full max-w-md shadow-2xl relative">
                        <button type="button" onClick={() => setShowResetModal(false)} className="absolute top-5 right-5 text-slate-400 hover:text-rose-500 transition-colors"><i className="fa-solid fa-xmark text-2xl"></i></button>
                        <h3 className="text-2xl font-black text-rose-600 mb-2"><i className="fa-solid fa-triangle-exclamation mr-2"></i> Reset Data Stok</h3>
                        <p className="text-slate-600 text-sm mb-6 font-semibold leading-relaxed">Tindakan ini akan <b>menghapus seluruh riwayat transaksi scan</b> (Barang Masuk/Keluar) dan mengembalikan semua stok menjadi 0. <span className="text-emerald-600">Master Produk Anda tidak akan dihapus.</span><br /><br />Masukkan Password Anda untuk memverifikasi.</p>
                        <form onSubmit={handleResetStok} action="javascript:void(0);" className="space-y-4">
                            <input required type="password" placeholder="Masukkan Password Anda..." value={resetPass} onChange={e => setResetPass(e.target.value)} className="w-full p-4 border-2 border-rose-200 focus:border-rose-500 outline-none rounded-xl font-bold bg-rose-50 focus:bg-white transition-colors" />
                            <button type="submit" className="w-full bg-rose-600 hover:bg-rose-700 text-white font-black py-4 rounded-xl shadow-xl shadow-rose-600/30 transition-transform transform hover:-translate-y-1">RESET STOK SEKARANG</button>
                        </form>
                    </div>
                </div>
            )}

            <div className="bg-slate-900 rounded-3xl p-8 shadow-xl text-white grid grid-cols-1 md:grid-cols-3 gap-8 divide-y md:divide-y-0 md:divide-x divide-slate-700 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5"><i className="fa-solid fa-box-open text-9xl"></i></div>
                <div className="px-4 relative z-10"><div className="flex items-center gap-2 mb-2"><i className="fa-solid fa-boxes-stacked text-orange-400"></i><p className="text-slate-400 text-sm font-bold uppercase tracking-wider">Total Stok Fisik</p></div><p className="text-5xl font-black text-white">{totalPhysicalStock} <span className="text-xl font-bold text-slate-500">Pcs</span></p></div>
                <div className="px-4 pt-6 md:pt-0 relative z-10"><div className="flex items-center gap-2 mb-2"><i className="fa-solid fa-wallet text-emerald-400"></i><p className="text-slate-400 text-sm font-bold uppercase tracking-wider">Total Nilai Aset (Beli)</p></div><p className="text-3xl font-black text-emerald-400">{formatRp(totalBuyValue)}</p></div>
                <div className="px-4 pt-6 md:pt-0 relative z-10"><div className="flex items-center gap-2 mb-2"><i className="fa-solid fa-sack-dollar text-orange-400"></i><p className="text-slate-400 text-sm font-bold uppercase tracking-wider">Estimasi Omzet (Jual)</p></div><p className="text-3xl font-black text-orange-400">{formatRp(totalSellValue)}</p></div>
            </div>

            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                <div className="p-6 border-b bg-slate-50 flex flex-col md:flex-row gap-4 md:gap-0 justify-between items-center">
                    <h3 className="text-xl font-black text-slate-800 flex items-center"><i className="fa-solid fa-table-list text-orange-500 mr-3"></i> Detail Stok Per Article</h3>
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <button type="button" onClick={() => setShowResetModal(true)} className="flex-1 md:flex-none bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-600 transition-colors px-5 py-3 rounded-xl font-black text-sm flex items-center justify-center border border-rose-100 shadow-sm"><i className="fa-solid fa-rotate-left mr-2 text-lg"></i> Reset Stok</button>
                        <button type="button" onClick={downloadExcel} className="flex-1 md:flex-none bg-emerald-100 hover:bg-emerald-600 hover:text-white text-emerald-700 transition-colors px-6 py-3 rounded-xl font-black text-sm flex items-center justify-center shadow-sm"><i className="fa-solid fa-file-excel mr-2 text-lg"></i> Download Excel</button>
                    </div>
                </div>
                <div className="overflow-x-auto custom-scrollbar pb-4">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-slate-100 text-slate-700 border-b-4 border-slate-200 whitespace-nowrap">
                            <tr>
                                <th className="p-5 font-black uppercase tracking-wider border-r">Article</th><th className="p-5 font-black uppercase tracking-wider border-r">Warna</th>
                                {allSizeNames.map(s => <th key={s} className="p-5 text-center border-r font-black uppercase text-orange-600 tracking-wider w-16">{s}</th>)}
                                <th className="p-5 text-center font-black uppercase tracking-wider bg-orange-100 text-blue-900 border-l-4 border-white">Total Qty</th><th className="p-5 text-right font-black uppercase tracking-wider border-r">Total Harga Beli</th><th className="p-5 text-right font-black uppercase tracking-wider bg-emerald-50 text-emerald-800 border-l border-emerald-100">Total Harga Jual</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tableRows.map((row, idx) => {
                                const totalPerColor = row.sizes.reduce((acc, curr) => acc + curr.stock, 0);
                                // Tampilkan total hitungan Size di layar tabel
                                const totalBeli = row.rowTotalBeli; const totalJual = row.rowTotalJual;
                                return (
                                    <tr key={`${row.article}-${row.colorName}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors whitespace-nowrap">
                                        {row.isFirstRow && (
                                            <td className="p-5 border-r border-slate-200 align-top bg-white" rowSpan={row.rowSpan}>
                                                <div className="font-extrabold text-slate-800 text-base">{row.article}</div>
                                                <div className="mt-2 text-xs font-normal text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100 inline-block">
                                                    <div className="flex items-center gap-2"><span className="w-8 font-bold">Beli:</span> <span className="font-mono">{formatRp(row.buyPrice)}</span></div>
                                                    <div className="flex items-center gap-2 mt-1 text-emerald-600"><span className="w-8 font-bold">Jual:</span> <span className="font-mono">{formatRp(row.sellPrice)}</span></div>
                                                </div>
                                            </td>
                                        )}
                                        <td className="p-5 font-bold text-slate-600 border-r border-slate-100">{row.colorName}</td>
                                        {allSizeNames.map(sz => {
                                            const matchedSize = row.sizes.find(s => s.sizeName === sz);
                                            const qty = matchedSize ? matchedSize.stock : 0;
                                            return <td key={sz} className={`p-5 text-center text-base border-r border-slate-100 ${qty <= 0 ? 'text-slate-300 font-medium' : 'text-slate-800 font-black bg-slate-50'}`}>{qty > 0 ? qty : '-'}</td>
                                        })}
                                        <td className="p-5 text-center font-black text-lg text-orange-600 bg-orange-50/50 border-l-4 border-white">{totalPerColor}</td>
                                        <td className="p-5 text-right font-bold text-slate-600 border-r border-slate-100">{totalBeli > 0 ? formatRp(totalBeli) : '-'}</td>
                                        <td className="p-5 text-right font-black text-emerald-600 bg-emerald-50/30 border-l border-emerald-50">{totalJual > 0 ? formatRp(totalJual) : '-'}</td>
                                    </tr>
                                );
                            })}
                            {tableRows.length === 0 && <tr><td colSpan={allSizeNames.length + 5} className="text-center p-12 text-slate-500 font-bold text-lg"><i className="fa-solid fa-box-open text-4xl block mb-3 text-slate-300"></i> Belum ada data stok.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// 6. Pantau Stok (Diperbarui)
function PantauStok({ variants, transactions, showToast }) {
    const inventoryData = useMemo(() => {
        const stockMap = {};
        transactions.forEach(t => {
            if (!t.fullBarcode) return;

            // EKSTRAK TANGGAL ASLI DARI BARCODE (Abaikan Suffix * atau #)
            let rawBase = t.fullBarcode;
            if (rawBase.includes('#')) rawBase = rawBase.split('#')[0];
            if (rawBase.includes('*')) rawBase = rawBase.split('*')[0];
            
            let recordDateStr = "2024-01-01T00:00:00Z";
            if (rawBase.startsWith('$')) {
                // Short Barcode: $X9K2-100626
                const parts = rawBase.split('-');
                if (parts.length > 1) {
                    const ddmmyy = parts[parts.length - 1]; // "100626"
                    if (ddmmyy.length === 6) {
                        const dd = ddmmyy.slice(0, 2);
                        const mm = ddmmyy.slice(2, 4);
                        const yy = "20" + ddmmyy.slice(4, 6);
                        recordDateStr = `${yy}-${mm}-${dd}T00:00:00Z`;
                    }
                }
            } else {
                // Legacy Barcode: F07-08.1-HITAM-4020260610
                const dateStr = rawBase.length > 8 ? rawBase.slice(-8) : "20240101";
                if (dateStr.length === 8) {
                    recordDateStr = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T00:00:00Z`;
                }
            }

            if (!stockMap[t.fullBarcode]) stockMap[t.fullBarcode] = { variant: variants.find(v => v.sku === t.sku), inQty: 0, outQty: 0, recordDateStr };
            if (t.type === 'IN' || t.type === 'REVISI_IN') stockMap[t.fullBarcode].inQty += t.qty;
            if (t.type === 'OUT' || t.type === 'REVISI_OUT') stockMap[t.fullBarcode].outQty += t.qty;
        });

        const activeStock = Object.keys(stockMap).map(barcode => {
            const item = stockMap[barcode];
            const sisa = item.inQty - item.outQty;
            if (sisa <= 0) return null;
            const recordDate = item.recordDateStr;
            const ageDays = (new Date() - new Date(recordDate)) / (1000 * 60 * 60 * 24);
            const ageMonths = ageDays / 30;
            return { ...item.variant, originalDate: recordDate, ageMonths, qty: sisa, fullBarcode: barcode };
        }).filter(Boolean);

        return {
            baru: activeStock.filter(i => i.ageMonths <= 3), lama: activeStock.filter(i => i.ageMonths > 3 && i.ageMonths <= 6),
            sudahLama: activeStock.filter(i => i.ageMonths > 6 && i.ageMonths <= 12), lamaBanget: activeStock.filter(i => i.ageMonths > 12)
        };
    }, [transactions, variants]);

    const [expanded, setExpanded] = useState({ baru: true, lama: true, sudahLama: true, lamaBanget: true });
    const toggleExp = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    const downloadExcel = () => {
        if (typeof XLSX === 'undefined') return showToast('error', "Tunggu sebentar, library Excel sedang dimuat.");
        const wb = XLSX.utils.book_new();
        const headers = ["Article", "Warna", "Size", "Tanggal Cetak Stiker", "Sisa Fisik Qty", "Barcode Unik"];

        const createSheetData = (dataArray) => {
            const sheetData = [headers];
            const sortedArray = [...dataArray].sort((a, b) => {
                // PERBAIKAN: Tambahkan pengaman (fallback) jika Master Produk sudah dihapus
                const artA = a.article || 'PRODUK DIHAPUS';
                const artB = b.article || 'PRODUK DIHAPUS';
                if (artA !== artB) return artA.localeCompare(artB);

                const colA = a.colorName || '-';
                const colB = b.colorName || '-';
                if (colA !== colB) return colA.localeCompare(colB);

                const szA = a.sizeName || '-';
                const szB = b.sizeName || '-';
                return szA.localeCompare(szB, undefined, { numeric: true });
            });

            let lastArticle = "";
            sortedArray.forEach(item => {
                const currentArticle = item.article || 'PRODUK DIHAPUS';
                const displayArticle = currentArticle === lastArticle ? "" : currentArticle; lastArticle = currentArticle;
                // PERBAIKAN: Berikan nilai kosong ('-') untuk warna dan size jika hilang
                sheetData.push([displayArticle, item.colorName || '-', item.sizeName || '-', new Date(item.originalDate).toLocaleDateString('id-ID'), item.qty, item.fullBarcode]);
            });
            return XLSX.utils.aoa_to_sheet(sheetData);
        };

        XLSX.utils.book_append_sheet(wb, createSheetData(inventoryData.baru), "Baru (0-3 Bln)");
        XLSX.utils.book_append_sheet(wb, createSheetData(inventoryData.lama), "Lama (3-6 Bln)");
        XLSX.utils.book_append_sheet(wb, createSheetData(inventoryData.sudahLama), "Sudah Lama (6-12 Bln)");
        XLSX.utils.book_append_sheet(wb, createSheetData(inventoryData.lamaBanget), "Lama Banget (>1 Thn)");
        XLSX.writeFile(wb, `Analisis_Umur_Stok_${new Date().toLocaleDateString('id-ID').replace(/\//g, '-')}.xlsx`);
    };

    const CategorySection = ({ title, dataKey, data, colorClass, borderClass, bgClass, subtitle, icon }) => {
        const isExp = expanded[dataKey];
        const totalItems = data.reduce((acc, curr) => acc + curr.qty, 0);
        return (
            <div className={`bg-white rounded-3xl border-4 ${borderClass} overflow-hidden shadow-lg transition-all`}>
                <div onClick={() => toggleExp(dataKey)} className={`p-6 ${bgClass} flex justify-between items-center cursor-pointer select-none hover:brightness-95 transition-all`}>
                    <div className="flex items-center gap-5"><div className={`w-14 h-14 rounded-2xl bg-white shadow-md flex items-center justify-center ${colorClass}`}><i className={`fa-solid ${icon} text-2xl`}></i></div><div><h3 className={`font-black text-2xl ${colorClass}`}>{title}</h3><p className="text-sm font-bold text-slate-600 mt-1">{subtitle} &bull; Sisa: <span className="underline">{totalItems} Pcs</span></p></div></div>
                    {isExp ? <i className={`fa-solid fa-chevron-up text-2xl ${colorClass}`}></i> : <i className={`fa-solid fa-chevron-down text-2xl ${colorClass}`}></i>}
                </div>
                {isExp && (
                    <div className="p-5 bg-white max-h-96 overflow-y-auto space-y-3 custom-scrollbar">
                        {data.map((item, i) => (
                            <div key={i} className="flex justify-between items-center p-4 border-2 border-slate-100 rounded-2xl bg-slate-50 hover:border-slate-300 transition-colors">
                                <div>
                                    <div className="font-black text-slate-800 text-lg">{item.article}</div>
                                    <div className="font-bold text-slate-500 text-sm mt-0.5">{item.colorName} - Sz: <span className="text-orange-500 font-black">{item.sizeName}</span></div>
                                    <div className="text-xs font-bold text-slate-400 mt-2 bg-white px-3 py-1.5 rounded-lg border shadow-sm"><i className="fa-regular fa-calendar-check mr-1 text-orange-500"></i> Cetak: {new Date(item.originalDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                                </div>
                                <div className="text-right"><span className="font-black text-xl bg-white px-5 py-3 rounded-2xl border-2 shadow-sm text-orange-600">{item.qty} Pcs</span></div>
                            </div>
                        ))}
                        {data.length === 0 && <div className="text-center py-10 text-slate-400"><i className="fa-solid fa-box-open text-5xl mb-4 opacity-30"></i><p className="font-bold">Stok kategori ini kosong / habis terjual.</p></div>}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-xl relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="absolute top-0 right-0 p-8 opacity-10"><i className="fa-solid fa-eye text-9xl"></i></div>
                <div className="relative z-10"><h2 className="text-3xl font-black flex items-center gap-3 mb-2"><i className="fa-solid fa-eye text-orange-400"></i> Analisis Umur Stok (FIFO)</h2><p className="text-slate-300 text-sm max-w-2xl leading-relaxed">Menghitung <b>Sisa Barang Fisik</b> berdasarkan tanggal cetak barcode secara otomatis.</p></div>
                <button type="button" onClick={downloadExcel} className="relative z-10 bg-emerald-500 hover:bg-emerald-400 text-white font-black px-6 py-4 rounded-2xl shadow-lg shadow-emerald-500/30 flex items-center transition-transform transform hover:-translate-y-1 w-full md:w-auto justify-center"><i className="fa-solid fa-file-excel text-2xl mr-3"></i> DOWNLOAD EXCEL</button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <CategorySection title="Stok Baru" subtitle="0 s/d 3 Bulan" dataKey="baru" data={inventoryData.baru} colorClass="text-emerald-600" borderClass="border-emerald-200" bgClass="bg-emerald-100" icon="fa-leaf" />
                <CategorySection title="Stok Lama" subtitle="3 s/d 6 Bulan" dataKey="lama" data={inventoryData.lama} colorClass="text-amber-600" borderClass="border-amber-200" bgClass="bg-amber-100" icon="fa-hourglass-half" />
                <CategorySection title="Stok Sudah Lama" subtitle="6 s/d 12 Bulan" dataKey="sudahLama" data={inventoryData.sudahLama} colorClass="text-orange-600" borderClass="border-orange-200" bgClass="bg-orange-100" icon="fa-calendar-minus" />
                <CategorySection title="Stok Lama Banget" subtitle="Lebih dari 1 Tahun" dataKey="lamaBanget" data={inventoryData.lamaBanget} colorClass="text-red-600" borderClass="border-red-200" bgClass="bg-red-100" icon="fa-triangle-exclamation" />
            </div>
        </div>
    );
}

// 7. Pengaturan & Akun (Kode Sama Percis)
function Pengaturan({ currentUser, setIsLoading, setProducts, setTransactions, setCurrentUser, showToast }) {
    const [users, setUsers] = useState([]);
    const [showAdd, setShowAdd] = useState(false);
    const [formUser, setFormUser] = useState({ username: '', password: '', role: 'staff', access: [] });
    const [resetPass, setResetPass] = useState('');

    useEffect(() => { const fetchUsers = async () => { const snap = await db.collection('users').get(); setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); }; fetchUsers(); }, []);

    const toggleAccess = (menuId) => { if (formUser.access.includes(menuId)) setFormUser({ ...formUser, access: formUser.access.filter(id => id !== menuId) }); else setFormUser({ ...formUser, access: [...formUser.access, menuId] }); };

    const handleSaveUser = async (e) => {
        e.preventDefault(); setIsLoading(true);
        const emailFormat = formUser.username.toLowerCase() + '@faradela.id';
        try {
            let secondaryApp;
            const apps = firebase.apps.filter(app => app.name === "Secondary");
            if (apps.length === 0) { secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary"); } else { secondaryApp = apps[0]; }
            await secondaryApp.auth().createUserWithEmailAndPassword(emailFormat, formUser.password);
            await secondaryApp.auth().signOut();

            await db.collection('users').add({ ...formUser, username: formUser.username.toLowerCase() });
            showToast('success', "Sub-akun berhasil ditambahkan!");
            setShowAdd(false); setFormUser({ username: '', password: '', role: 'staff', access: [] });
            const snap = await db.collection('users').get(); setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (err) { showToast('error', err.message); }
        setIsLoading(false);
    };

    const handleDeleteUser = async (id) => {
        if (confirm('Hapus akun karyawan ini secara permanen?')) { setIsLoading(true); await db.collection('users').doc(id).delete(); setUsers(users.filter(u => u.id !== id)); setIsLoading(false); }
    };

    const handleReset = async (e) => {
        e.preventDefault();
        if (resetPass !== currentUser.password) return showToast('error', "GAGAL: Password Salah!");
        if (confirm('TINDAKAN INI TIDAK BISA DIBATALKAN. Hapus seluruh data produk dan transaksi sekarang?')) {
            setIsLoading(true);
            try { 
                const prodDocs = await db.collection('products').get(); 
                const txDocs = await db.collection('transactions').get(); 
                
                const batches = [];
                let currentBatch = db.batch();
                let operationCounter = 0;

                const addToDeleteBatch = (doc) => {
                    currentBatch.delete(doc.ref);
                    operationCounter++;
                    if (operationCounter === 450) {
                        batches.push(currentBatch);
                        currentBatch = db.batch();
                        operationCounter = 0;
                    }
                };

                prodDocs.docs.forEach(addToDeleteBatch);
                txDocs.docs.forEach(addToDeleteBatch);
                
                if (operationCounter > 0) batches.push(currentBatch);
                
                for (const batch of batches) {
                    await batch.commit();
                }

                showToast('success', 'Semua data berhasil dihapus!'); 
                setProducts([]); 
                setTransactions([]); 
                setResetPass(''); 
            } catch (error) { 
                showToast('error', "Gagal mereset data: " + error.message); 
            } 
            setIsLoading(false);
        }
    };

    if (currentUser.role !== 'admin') return <div className="p-10 font-bold text-red-500 text-center text-xl bg-red-50 rounded-2xl border-2 border-red-200">Akses Ditolak. Halaman ini hanya untuk Admin Utama.</div>;

    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-3xl border shadow-sm">
                <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-4">
                    <h3 className="text-xl font-black text-slate-800"><i className="fa-solid fa-users-gear text-orange-500 mr-2"></i> Manajemen Sub-Akun</h3>
                    <button type="button" onClick={() => setShowAdd(!showAdd)} className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-colors ${showAdd ? 'bg-slate-200 text-slate-600' : 'bg-orange-100 text-orange-600 hover:bg-orange-500 hover:text-white'}`}><i className={`fa-solid ${showAdd ? 'fa-xmark' : 'fa-plus'} mr-1`}></i> {showAdd ? 'Batal' : 'Tambah Karyawan'}</button>
                </div>

                {showAdd && (
                    <form onSubmit={handleSaveUser} action="javascript:void(0);" className="mb-8 p-6 bg-slate-50 border-2 border-slate-200 rounded-2xl space-y-5 shadow-inner">
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block text-sm font-bold text-slate-700 mb-1">Username</label><input required className="w-full p-3 border-2 border-slate-300 rounded-xl focus:border-orange-500 outline-none" value={formUser.username} onChange={e => setFormUser({ ...formUser, username: e.target.value })} /></div>
                            <div><label className="block text-sm font-bold text-slate-700 mb-1">Password</label><input required className="w-full p-3 border-2 border-slate-300 rounded-xl focus:border-orange-500 outline-none" value={formUser.password} onChange={e => setFormUser({ ...formUser, password: e.target.value })} /></div>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Beri Akses Menu:</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {[
                                    ...ALL_MENUS.filter(m => !m.adminOnly && m.id !== 'dashboard' && m.id !== 'cek_surat_jalan').map(m => ({ id: m.id, label: m.label })),
                                    { id: 'sj_lery', label: 'Bengkel - Lery Workshop (F01)' },
                                    { id: 'sj_samin', label: 'Bengkel - Pak Samin (F07)' },
                                    { id: 'sj_faradela', label: 'Penerima - Faradela Official' },
                                    { id: 'delete_antrean', label: 'Akses Hapus Pesanan Online' }
                                ].map(m => (
                                    <label key={m.id} className={`flex items-center gap-3 text-sm p-3 border-2 rounded-xl cursor-pointer transition-colors ${formUser.access.includes(m.id) ? 'bg-orange-50 border-orange-400 font-bold text-blue-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}><input type="checkbox" checked={formUser.access.includes(m.id)} onChange={() => toggleAccess(m.id)} className="w-5 h-5 rounded text-orange-500 focus:ring-blue-500" />{m.label}</label>
                                ))}
                            </div>
                        </div>
                        <button className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black py-4 rounded-xl mt-4 shadow-lg shadow-orange-500/30">SIMPAN SUB-AKUN</button>
                    </form>
                )}

                <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
                    {users.map(u => (
                        <div key={u.id} className="flex justify-between items-center p-5 border-2 border-slate-100 rounded-2xl bg-white shadow-sm hover:border-slate-300 transition-colors">
                            <div>
                                <div className="font-black text-slate-800 text-lg">{u.username} <span className={`text-[10px] px-2 py-0.5 rounded-md ml-2 uppercase align-middle ${u.role === 'admin' ? 'bg-orange-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>{u.role}</span></div>
                                <div className="text-xs text-slate-500 font-semibold mt-1.5 leading-relaxed">
                                    Akses: {u.role === 'admin' ? 'Semua Menu (Full Access)' : (
                                        (u.access || []).length > 0 ? (u.access || []).map(accId => {
                                            const found = ALL_MENUS.find(m => m.id === accId);
                                            if (found) return found.label;
                                            if (accId === 'sj_lery') return 'Workshop (F01)';
                                            if (accId === 'sj_samin') return 'Workshop (F07)';
                                            if (accId === 'sj_faradela') return 'Penerima';
                                            if (accId === 'delete_antrean') return 'Hapus Pesanan Online';
                                            return accId;
                                        }).join(', ') : 'Tidak Ada Akses'
                                    )}
                                </div>
                            </div>
                            {u.username !== 'admin' && <button type="button" onClick={() => handleDeleteUser(u.id)} className="text-rose-500 w-12 h-12 flex items-center justify-center bg-rose-50 hover:bg-rose-500 hover:text-white rounded-xl transition-colors border border-rose-100"><i className="fa-solid fa-trash-can text-lg"></i></button>}
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-rose-50 p-8 rounded-3xl border-4 border-rose-200 h-fit shadow-sm relative overflow-hidden">
                <i className="fa-solid fa-triangle-exclamation absolute top-5 right-5 text-rose-500 text-8xl opacity-10"></i>
                <h3 className="text-2xl font-black text-rose-800 mb-3 relative z-10"><i className="fa-solid fa-skull text-rose-600 mr-2"></i> Danger Zone: Reset Data</h3>
                <p className="text-sm text-rose-700 font-semibold mb-6 relative z-10">Tindakan ini akan <b className="uppercase">menghapus seluruh</b> Master Produk dan Riwayat Transaksi secara permanen. Database akan dikosongkan. Masukkan Password Admin Utama untuk memverifikasi.</p>
                <form onSubmit={handleReset} action="javascript:void(0);" className="space-y-4 relative z-10">
                    <input required type="password" placeholder="Masukkan Password Admin..." value={resetPass} onChange={e => setResetPass(e.target.value)} className="w-full p-4 border-2 border-rose-300 focus:border-rose-600 outline-none rounded-xl font-bold bg-white" />
                    <button type="submit" className="w-full bg-rose-600 hover:bg-rose-700 text-white font-black py-4 rounded-xl shadow-xl shadow-rose-600/30 transition-transform transform hover:-translate-y-1">HAPUS SELURUH DATA SEKARANG</button>
                </form>
            </div>
        </div>
    );
}

// ==========================================
// MPO PABRIK V2 (INPUT MATRIKS, PREVIEW, SCAN KIRIM)
// ==========================================
function ManajemenMPO({ variants, mpoOrders = [], showToast, setIsLoading }) {
    const [showForm, setShowForm] = useState(false);
    const [targetDate, setTargetDate] = useState('');
    const [poDate, setPoDate] = useState(new Date().toISOString().split('T')[0]);
    const [mpoDraftList, setMpoDraftList] = useState(() => {
        try {
            const saved = localStorage.getItem('smart_mpo_draft');
            if (saved) {
                // Hapus setelah dibaca supaya tidak nyangkut terus-terusan
                localStorage.removeItem('smart_mpo_draft');
                return JSON.parse(saved);
            }
        } catch (e) { console.error(e); }
        return [];
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [qtys, setQtys] = useState({});
    const [previewModal, setPreviewModal] = useState(false);

    const nextPoNumber = mpoOrders.length > 0 ? Math.max(...mpoOrders.map(o => o.poNumber)) + 1 : 1;
    const newPoId = 'PO' + nextPoNumber;

    const safeLower = (str) => (str || '').toString().toLowerCase();
    const query = (searchQuery || '').toLowerCase().trim();
    const filteredVariants = variants.filter(v => {
        if (!v.isActive || !query) return false;
        if (/^\d{8,}$/.test(query)) return safeLower(v.sku) === query || safeLower(v.baseCode) === query;
        const words = query.split(/\s+/);
        return words.every(word => safeLower(v.article).includes(word) || safeLower(v.colorName).includes(word) || safeLower(v.sizeName).includes(word) || safeLower(v.sku).includes(word) || safeLower(v.baseCode).includes(word));
    }).slice(0, 30);

    const addToDraft = (variant) => {
        if (!targetDate) return showToast('error', 'Silakan isi Target Tanggal Selesai terlebih dahulu!');
        const qty = qtys[variant.sku] || 1;
        const existingList = [...mpoDraftList];
        const existingIdx = existingList.findIndex(x => x.sku === variant.sku);
        if (existingIdx > -1) {
            existingList[existingIdx].qty += qty;
        } else {
            existingList.push({ ...variant, qty, received: 0, shipped: 0 });
        }
        setMpoDraftList(existingList);
        showToast('success', `${qty} pcs ${variant.article} ${variant.sizeName} dimasukkan antrean MPO.`);
    };

    const removeDraft = (sku) => {
        setMpoDraftList(mpoDraftList.filter(x => x.sku !== sku));
    };

    const getFlatItems = () => mpoDraftList;

    const askPreview = (e) => {
        if (e) e.preventDefault();
        if (!poDate) return showToast('error', 'Tanggal PO harus diisi!');
        if (!targetDate) return showToast('error', 'Tanggal Target harus diisi!');
        if (mpoDraftList.length === 0) return showToast('error', 'Isi Antrean PO minimal 1 produk!');
        setPreviewModal(true);
    };

    const handleSaveMPO = async () => {
        const flat = getFlatItems();
        setIsLoading(true);
        try {
            const poData = {
                id: newPoId,
                poNumber: nextPoNumber,
                poDate: poDate,
                targetDate: targetDate,
                createdAt: new Date().toISOString(),
                status: 'OPEN',
                items: flat.map(i => ({
                    sku: i.sku,
                    article: i.article,
                    colorName: i.colorName,
                    sizeName: i.sizeName,
                    qty: i.qty,
                    received: i.received,
                    shipped: i.shipped
                }))
            };
            await db.collection('purchase_orders').doc(newPoId).set(poData);

            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(e => console.log(e));

            showToast('success', `PO Pabrik [${newPoId}] berhasil dibuat!`);
            setPreviewModal(false);
            setShowForm(false);
            setMpoDraftList([]); // CHANGED
            setTargetDate('');
        } catch (err) {
            showToast('error', 'Gagal membuat PO: ' + err.message);
        }
        setIsLoading(false);
    };
    const cetakMPO = (po) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return showToast('error', 'Izinkan Pop-up Blocker untuk cetak PO!');

        // ---- Build matrix data: group by article+color, columns = sizes ----
        const allSizes = [...new Set(po.items.map(i => i.sizeName))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const groups = [];
        po.items.forEach(item => {
            let g = groups.find(g => g.article === item.article && g.colorName === item.colorName);
            if (!g) { g = { article: item.article, colorName: item.colorName, sizes: {} }; groups.push(g); }
            g.sizes[item.sizeName] = (g.sizes[item.sizeName] || 0) + item.qty;
        });
        groups.sort((a, b) => {
            // Sorting Artikel (Urutan sama dengan Stok Detail)
            const infoA = parseArticleForSortGlobal(a.article);
            const infoB = parseArticleForSortGlobal(b.article);

            if (infoA.prefix !== infoB.prefix) return infoA.prefix.localeCompare(infoB.prefix, undefined, { numeric: true });
            if (infoA.group !== infoB.group) return infoA.group - infoB.group;
            if (infoA.num !== infoB.num) return infoA.num - infoB.num;

            // Sorting Warna (Urutan sesuai Master Produk / Stok Detail)
            const varA = variants.find(v => v.article === a.article && v.colorName === a.colorName);
            const varB = variants.find(v => v.article === b.article && v.colorName === b.colorName);
            const colA = varA ? (varA.colorIndex !== undefined ? varA.colorIndex : 999) : 999;
            const colB = varB ? (varB.colorIndex !== undefined ? varB.colorIndex : 999) : 999;
            if (colA !== colB) return colA - colB;

            return 0;
        });

        const grandTotal = po.items.reduce((s, i) => s + i.qty, 0);
        const poDateLabel = po.poDate || po.createdAt?.split('T')[0] || '-';

        // ---- Build article rowspan info ----
        const articleRowCount = {};
        groups.forEach(g => { articleRowCount[g.article] = (articleRowCount[g.article] || 0) + 1; });
        const articleRendered = {};

        // ---- Helper: color-coded warna cell ----
        const colorCell = (name) => {
            const c = name.toLowerCase();
            let style = '';
            if (c.includes('hitam')) style = 'background:#1e1e1e;color:#fff;';
            else if (c.includes('putih')) style = 'background:#f0f0f0;color:#333;border:1px solid #ccc;';
            else if (c.includes('abu') || c.includes('grey') || c.includes('gray') || c.includes('silver')) style = 'background:#9e9e9e;color:#fff;';
            else if (c.includes('maroon')) style = 'background:#7b1f3a;color:#fff;';
            else if (c.includes('merah') || c.includes('red')) style = 'background:#e53935;color:#fff;';
            else if (c.includes('biru') || c.includes('blue') || c.includes('navy')) style = 'background:#1565c0;color:#fff;';
            else if (c.includes('nude') || c.includes('cream')) style = 'background:#e8c99a;color:#5d4037;';
            else if (c.includes('vanilla') || c.includes('vanila')) style = 'background:#f5e6c8;color:#5d4037;';
            else if (c.includes('nudo')) style = 'background:#d4aa7d;color:#4e342e;';
            else if (c.includes('coklat') || c.includes('brown') || c.includes('mocca')) style = 'background:#795548;color:#fff;';
            else if (c.includes('hijau') || c.includes('green') || c.includes('olive')) style = 'background:#2e7d32;color:#fff;';
            else if (c.includes('baby pink')) style = 'background:#f8bbd0;color:#880e4f;';
            else if (c.includes('pink') || c.includes('salem') || c.includes('rose')) style = 'background:#e91e63;color:#fff;';
            else if (c.includes('kuning') || c.includes('yellow') || c.includes('gold')) style = 'background:#f9a825;color:#333;';
            else if (c.includes('ungu') || c.includes('purple') || c.includes('lilac') || c.includes('lavender')) style = 'background:#7b1fa2;color:#fff;';
            else if (c.includes('orange') || c.includes('oren')) style = 'background:#ef6c00;color:#fff;';
            else if (c.includes('apricot') || c.includes('peach')) style = 'background:#ffab91;color:#4e342e;';
            else if (c.includes('tan') || c.includes('khaki') || c.includes('beige')) style = 'background:#d2b48c;color:#4e342e;';
            else if (c.includes('tosca') || c.includes('teal') || c.includes('cyan') || c.includes('mint')) style = 'background:#00897b;color:#fff;';
            else if (c.includes('burgundy') || c.includes('wine')) style = 'background:#6d1a36;color:#fff;';
            else style = 'background:#fff3e0;color:#e65100;border:1px solid #ffcc80;';
            return `<span style="display:inline-block;padding:3px 10px;border-radius:5px;font-weight:900;font-size:10px;letter-spacing:.5px;text-transform:uppercase;${style}">${name}</span>`;
        };

        // ---- Build table rows ----
        let rowsHtml = '';
        groups.forEach((g) => {
            const isFirst = !articleRendered[g.article];
            const rowspan = articleRowCount[g.article];
            articleRendered[g.article] = true;
            const rowTotal = allSizes.reduce((s, sz) => s + (g.sizes[sz] || 0), 0);
            rowsHtml += `<tr>`;
            if (isFirst) rowsHtml += `<td rowspan="${rowspan}" style="font-weight:900;font-size:13px;text-align:center;vertical-align:middle;background:#fff8f0;border-right:2px solid #e65100;">${g.article}</td>`;
            rowsHtml += `<td style="text-align:center;vertical-align:middle;">${colorCell(g.colorName)}</td>`;
            allSizes.forEach(sz => {
                const qty = g.sizes[sz] || 0;
                rowsHtml += `<td style="text-align:center;font-weight:${qty > 0 ? '900' : '400'};color:${qty > 0 ? '#333' : '#bbb'};">${qty > 0 ? qty : '-'}</td>`;
            });
            rowsHtml += `<td style="text-align:center;font-weight:900;color:#e65100;background:#fff3e0;">${rowTotal}</td>`;
            rowsHtml += `</tr>`;
        });

        // ---- Column totals footer ----
        let footerHtml = `<tr style="background:#f0f4f8;font-weight:900;font-size:13px;">`;
        footerHtml += `<td colspan="2" style="text-align:center;letter-spacing:1px;border-top:2px solid #333;">GRAND TOTAL</td>`;
        allSizes.forEach(sz => {
            const colTotal = groups.reduce((s, g) => s + (g.sizes[sz] || 0), 0);
            footerHtml += `<td style="text-align:center;color:#333;border-top:2px solid #333;">${colTotal > 0 ? colTotal : '-'}</td>`;
        });
        footerHtml += `<td style="text-align:center;font-weight:900;font-size:16px;color:#e65100;background:#ffe0b2;border-top:2px solid #e65100;">${grandTotal}</td>`;
        footerHtml += `</tr>`;

        const sizeHeaders = allSizes.map(sz => `<th style="text-align:center;color:#e65100;background:#fff8f0;min-width:36px;">${sz}</th>`).join('');

        const htmlContent = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Cetak PO ${po.id}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #222; background: #fff; }

    /* ===== HEADER AREA ===== */
    .page-header { border: 2.5px solid #e65100; border-radius: 8px; padding: 14px 18px 10px; margin-bottom: 16px; position: relative; }
    .company-name { font-size: 20px; font-weight: 900; color: #e65100; letter-spacing: 1px; text-align: center; text-transform: uppercase; }
    .doc-title { font-size: 13px; font-weight: 900; color: #333; text-align: center; text-transform: uppercase; letter-spacing: 2px; margin-top: 2px; }
    .bengkel-badge {
      display: inline-block; background: #e65100; color: #fff;
      font-size: 11px; font-weight: 900; padding: 2px 12px;
      border-radius: 20px; letter-spacing: 2px; text-transform: uppercase;
      margin-top: 4px;
    }
    .header-center { text-align: center; }
    .po-info { display: flex; justify-content: center; gap: 24px; margin-top: 10px; font-size: 11px; font-weight: bold; color: #555; flex-wrap: wrap; }
    .po-info span { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 6px; padding: 3px 12px; }
    .po-info span b { color: #e65100; }

    /* ===== TABLE ===== */
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th { background: #e65100; color: #fff; padding: 7px 6px; font-size: 11px; text-align: center; text-transform: uppercase; border: 1px solid #c94b00; }
    td { border: 1px solid #d0d0d0; padding: 6px; font-size: 11px; vertical-align: middle; }
    tr:nth-child(even) td { background: #fafafa; }
    tr:hover td { background: #fff3e0; }

    /* ===== FOOTER ===== */
    .sign-area { display: flex; justify-content: space-around; margin-top: 24px; }
    .sign-box { text-align: center; width: 30%; }
    .sign-box .label { font-size: 10px; font-weight: bold; color: #777; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .sign-box .role { font-size: 11px; font-weight: 900; color: #333; margin-bottom: 50px; }
    .sign-box .line { border-top: 1.5px solid #333; padding-top: 4px; font-size: 10px; color: #888; }
    .footer-note { text-align:center; font-size:9px; color:#aaa; margin-top: 12px; border-top:1px dashed #ddd; padding-top: 6px; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <div class="page-header">
    <div class="header-center">
      <div class="company-name">&#x1F3ED; FARADELA OFFICIAL</div>
      <div class="doc-title">Surat Pesanan (Purchase Order)</div>
      <div><span class="bengkel-badge">&#x22C6; Bengkel &#x22C6;</span></div>
    </div>
    <div class="po-info">
      <span><b>No. PO:</b> ${po.id}</span>
      <span><b>Tanggal PO:</b> ${poDateLabel}</span>
      <span><b>Target Selesai:</b> ${po.targetDate || '-'}</span>
      <span><b>Total:</b> ${grandTotal} Pcs</span>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Article</th>
        <th>Warna</th>
        ${sizeHeaders}
        <th style="background:#c94b00;min-width:44px;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      ${footerHtml}
    </tfoot>
  </table>

  <div class="sign-area">
    <div class="sign-box">
      <div class="label">Dibuat Oleh</div>
      <div class="role">Tim Gudang</div>
      <div class="line">(................................)</div>
    </div>
    <div class="sign-box">
      <div class="label">Disetujui Oleh</div>
      <div class="role">Pimpinan</div>
      <div class="line">(................................)</div>
    </div>
    <div class="sign-box">
      <div class="label">Diterima Oleh</div>
      <div class="role">Pihak Bengkel</div>
      <div class="line">(................................)</div>
    </div>
  </div>

  <div class="footer-note">Dokumen ini dicetak secara otomatis oleh sistem Faradela Management &bull; ${poDateLabel}</div>

  <script>setTimeout(() => window.print(), 600);<\/script>
</body>
</html>`;
        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    };

    const getProductionCode = (dateString) => {
        if (!dateString) return "";
        const parts = dateString.split('T')[0].split('-');
        if (parts.length !== 3) return "";
        const y = parts[0].slice(-2);
        const m = parseInt(parts[1], 10).toString();
        const mapChar = (char) => ({ '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', '6': 'F', '7': 'G', '8': 'H', '9': 'I', '0': 'J' }[char] || char);
        return `${y.split('').map(mapChar).join('')}-${m.split('').map(mapChar).join('')}`;
    };

    const cetakBarcodePO = (po) => {
        // ---- Kumpulkan SEMUA label ke array terlebih dahulu ----
        const BATCH_SIZE = 80;
        const allLabelHtmls = [];

        const targetDateStr = po.targetDate || new Date().toISOString().split('T')[0];
        const suffixDate = targetDateStr.replace(/-/g, '');
        const prodCode = getProductionCode(targetDateStr);

        po.items.forEach(item => {
            const variantRef = variants.find(v => v.sku === item.sku) || {};
            const fullBarcode = buildShortBarcode(variantRef, po.targetDate || po.createdAt.split('T')[0], 'PO', po.poNumber);
            const toPrint = item.qty - (item.received || 0);

            for (let i = 0; i < toPrint; i++) {
                allLabelHtmls.push(`
                            <div class="label-container">
                                <div class="label-grid">
                                    <div class="po-corner">#${po.id}</div>
                                    <div class="cell br bb">${variantRef.photo ? `<img class="photo" src="${variantRef.photo}" />` : '<div style="font-size:10px;">No Img</div>'}</div>
                                    <div class="cell br bb" style="flex-direction: column;"><svg class="barcode-svg" jsbarcode-value="${fullBarcode}" jsbarcode-format="CODE128" jsbarcode-width="2" jsbarcode-height="55" jsbarcode-displayvalue="false" jsbarcode-margin="0" jsbarcode-fontsize="14"></svg></div>
                                    <div class="cell bb"><div class="prod-code">${prodCode}</div></div>
                                    <div class="cell br" style="flex-direction: column;"><div class="size-text">${item.sizeName}</div><div class="color-text">${item.colorName}</div></div>
                                    <div class="cell br" style="flex-direction: column;"><div class="article-text">${item.article}</div><div class="price-text">Rp. ${(variantRef.sellPrice || 0).toLocaleString('id-ID')}</div></div>
                                    <div class="cell"><div class="qrcode-target" data-value="${fullBarcode}"></div></div>
                                </div>
                            </div>
                        `);
            }
        });

        if (allLabelHtmls.length === 0) {
            showToast('error', 'Tidak ada label yang perlu dicetak (semua sudah diterima).');
            return;
        }

        // ---- CSS & Script yang sama dipakai di tiap window ----
        const pageStyle = `
                    <!DOCTYPE html><html><head>
                    <title>Cetak Label PO ${po.id}</title>
                    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
                    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
                    <style>
                        @page { margin: 0; }
                        body { margin: 0; padding: 0; font-family: sans-serif; background-color: white; }
                        .label-container { width: 471px; height: 215px; margin: 5px; padding: 0; border: none; box-sizing: border-box; page-break-after: always; page-break-inside: avoid; overflow: hidden; background-color: white; display: flex; justify-content: center; align-items: center; }
                        .label-grid { width: 100%; height: 100%; border: 2px solid black; display: grid; grid-template-columns: 1.4fr 2.4fr 0.9fr; grid-template-rows: 1fr 1fr; box-sizing: border-box; position: relative; }
                        .cell { display: flex; justify-content: center; align-items: center; padding: 5px; box-sizing: border-box; text-align: center; overflow: hidden; }
                        .br { border-right: 1px solid black; }
                        .bb { border-bottom: 1px solid black; }
                        .photo { max-width: 100%; max-height: 100%; object-fit: contain; }
                        .barcode-svg { max-width: 100%; max-height: 100%; margin-top: 8px; }
                        .size-text { font-size: 48px; font-weight: 900; line-height: 1; }
                        .color-text { font-size: 18px; font-weight: bold; text-transform: uppercase; margin-top: 4px; }
                        .prod-code { font-size: 36px; font-weight: 900; letter-spacing: 2px; }
                        .article-text { font-size: 20px; font-weight: 900; }
                        .mpo-badge { font-size: 14px; background: black; color: white; padding: 2px 5px; margin-top: 5px; font-weight: bold; }
                        .sell-price { font-size: 32px; font-weight: 900; margin-top: 2px; margin-bottom: 5px; }
                        .po-corner { position: absolute; top: 1px; right: 2px; font-size: 12px; font-weight: 900; color: black; z-index: 10; padding: 2px; }
                        .price-text { font-size: 14px; font-weight: 900; color: #222; margin-top: 4px; border: 1.5px solid #666; padding: 2px 8px; border-radius: 4px; }
                    </style></head><body>`;

        const pageScript = `
                    <script>
                        window.onload = function() {
                            if(window.JsBarcode) { JsBarcode(".barcode-svg").init(); }
                            if(window.QRCode) {
                                var qrcodes = document.querySelectorAll('.qrcode-target');
                                qrcodes.forEach(function(el) { new QRCode(el, { text: el.getAttribute('data-value'), width: 70, height: 70, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L }); });
                            }
                        };
                    <\/script></body></html>`;

        // ---- Buka 1 tab per batch (maks BATCH_SIZE label) ----
        const totalBatches = Math.ceil(allLabelHtmls.length / BATCH_SIZE);
        for (let b = 0; b < totalBatches; b++) {
            const chunk = allLabelHtmls.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
            setTimeout(() => {
                const win = window.open('', '_blank');
                if (!win) { showToast('error', 'Gagal membuka tab! Izinkan Pop-up di browser.'); return; }
                win.document.open();
                win.document.write(pageStyle + chunk.join('') + pageScript);
                win.document.close();
            }, b * 400);
        }

        if (totalBatches > 1) {
            showToast('success', `${allLabelHtmls.length} label dibagi menjadi ${totalBatches} tab cetak (maks 80/tab).`);
        }
    };

    const deletePO = async (id) => {
        if (confirm('Hapus PO ini secara permanen?')) {
            setIsLoading(true);
            await db.collection('purchase_orders').doc(id).delete();
            setIsLoading(false);
        }
    };

    const previewSizes = Array.from(new Set(mpoDraftList.map(i => i.sizeName))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const previewGroups = [];
    [...mpoDraftList].sort((a, b) => {
        if (a.article !== b.article) return a.article.localeCompare(b.article);
        return 0;
    }).forEach(item => {
        let group = previewGroups.find(g => g.article === item.article && g.colorName === item.colorName);
        if (!group) { group = { article: item.article, colorName: item.colorName, sizes: {} }; previewGroups.push(group); }
        group.sizes[item.sizeName] = (group.sizes[item.sizeName] || 0) + item.qty;
    });

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 md:p-8 rounded-3xl border shadow-sm flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><i className="fa-solid fa-industry text-orange-500"></i> Manajemen PO Bengkel</h2>
                    <p className="text-slate-500 font-bold text-sm mt-1">Buat Matrix Order, cetak SP dan label barcode</p>
                </div>
                {showForm ? (
                    <button onClick={() => setShowForm(false)} className="px-5 py-2.5 bg-slate-200 text-slate-700 rounded-xl font-black transition-colors">Batal</button>
                ) : (
                    <button onClick={() => setShowForm(true)} className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white shadow-md rounded-xl font-black transition-colors">+ BIKIN PO MPO</button>
                )}
            </div>


            {previewModal && (() => {
                // Helper: color badge style for warna names
                const getColorBadgeStyle = (name) => {
                    const c = (name || '').toLowerCase();
                    if (c.includes('hitam')) return { background: '#1e1e1e', color: '#fff' };
                    if (c.includes('putih')) return { background: '#f0f0f0', color: '#333', border: '1px solid #ccc' };
                    if (c.includes('abu')) return { background: '#9e9e9e', color: '#fff' };
                    if (c.includes('merah') || c.includes('red')) return { background: '#e53935', color: '#fff' };
                    if (c.includes('maroon')) return { background: '#7b1f3a', color: '#fff' };
                    if (c.includes('biru') || c.includes('blue') || c.includes('navy')) return { background: '#1565c0', color: '#fff' };
                    if (c.includes('nude') || c.includes('cream')) return { background: '#e8c99a', color: '#5d4037' };
                    if (c.includes('vanilla') || c.includes('vanila')) return { background: '#f5e6c8', color: '#5d4037' };
                    if (c.includes('nudo')) return { background: '#d4aa7d', color: '#4e342e' };
                    if (c.includes('coklat') || c.includes('brown') || c.includes('mocca')) return { background: '#795548', color: '#fff' };
                    if (c.includes('hijau') || c.includes('green') || c.includes('olive')) return { background: '#2e7d32', color: '#fff' };
                    if (c.includes('pink') || c.includes('salem') || c.includes('rose')) return { background: '#e91e63', color: '#fff' };
                    if (c.includes('kuning') || c.includes('yellow') || c.includes('gold')) return { background: '#f9a825', color: '#333' };
                    if (c.includes('ungu') || c.includes('purple') || c.includes('lilac') || c.includes('lavender')) return { background: '#7b1fa2', color: '#fff' };
                    if (c.includes('orange') || c.includes('oren')) return { background: '#ef6c00', color: '#fff' };
                    if (c.includes('silver') || c.includes('grey') || c.includes('gray')) return { background: '#bdbdbd', color: '#333' };
                    if (c.includes('apricot') || c.includes('peach')) return { background: '#ffab91', color: '#4e342e' };
                    if (c.includes('tan') || c.includes('khaki') || c.includes('beige')) return { background: '#d2b48c', color: '#4e342e' };
                    if (c.includes('tosca') || c.includes('teal') || c.includes('cyan') || c.includes('mint')) return { background: '#00897b', color: '#fff' };
                    if (c.includes('burgundy') || c.includes('wine')) return { background: '#6d1a36', color: '#fff' };
                    // Default: orange accent
                    return { background: '#fff3e0', color: '#e65100', border: '1px solid #ffcc80' };
                };

                return (
                    <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
                            <h3 className="text-2xl font-black text-slate-800 mb-2">Preview PO <span className="text-orange-500">{newPoId}</span></h3>
                            <p className="text-slate-500 font-bold text-sm mb-6 border-b pb-4">Tanggal PO: {poDate} &nbsp;|&nbsp; Target Selesai: {targetDate}</p>
                            <div className="flex-1 overflow-auto bg-slate-50 border rounded-2xl mb-6 shadow-inner p-2 custom-scrollbar">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead className="bg-slate-100 text-slate-700 border-b-4 border-slate-200 whitespace-nowrap">
                                        <tr>
                                            <th className="p-3 font-black uppercase text-center border-r">Article</th>
                                            <th className="p-3 font-black uppercase text-center border-r">Warna</th>
                                            {previewSizes.map(sz => (
                                                <th key={sz} className="p-3 text-center border-r font-black uppercase text-orange-600 w-12">{sz}</th>
                                            ))}
                                            <th className="p-3 text-center font-black uppercase bg-orange-100 text-blue-900 w-24">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewGroups.map((group, idx) => {
                                            const rowTotal = previewSizes.reduce((sum, sz) => sum + (group.sizes[sz] || 0), 0);
                                            const isFirstRowForArticle = previewGroups.findIndex(g => g.article === group.article) === idx;
                                            const rowsForArticle = previewGroups.filter(g => g.article === group.article).length;

                                            return (
                                                <tr key={idx} className="border-b border-slate-100 hover:bg-white transition-colors whitespace-nowrap">
                                                    {isFirstRowForArticle && (
                                                        <td className="p-3 border-r border-slate-100 font-black text-slate-800 text-base text-center align-middle bg-white" rowSpan={rowsForArticle}>
                                                            {group.article}
                                                        </td>
                                                    )}
                                                    <td className="p-3 border-r border-slate-100 text-center">
                                                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '6px', fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px', textTransform: 'uppercase', ...getColorBadgeStyle(group.colorName) }}>{group.colorName}</span>
                                                    </td>
                                                    {previewSizes.map(sz => {
                                                        const qty = group.sizes[sz] || 0;
                                                        return (
                                                            <td key={sz} className={`p-3 text-center text-base border-r border-slate-100 ${qty <= 0 ? 'text-slate-300 font-medium' : 'text-slate-800 font-black bg-slate-50'}`}>
                                                                {qty > 0 ? qty : '-'}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="p-3 text-center font-black text-lg text-orange-600 bg-orange-50/50">
                                                        {rowTotal}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-slate-200/50 font-black whitespace-nowrap">
                                        <tr>
                                            <td className="p-3 text-right uppercase border-r border-slate-300" colSpan={2}>GRAND TOTAL</td>
                                            {previewSizes.map(sz => {
                                                const colTotal = previewGroups.reduce((acc, g) => acc + (g.sizes[sz] || 0), 0);
                                                return (
                                                    <td key={sz} className="p-3 text-center border-r border-slate-300 text-slate-800 text-lg">
                                                        {colTotal > 0 ? colTotal : '-'}
                                                    </td>
                                                );
                                            })}
                                            <td className="p-3 text-center text-orange-700 bg-orange-200 text-2xl border-t-2 border-orange-300">
                                                {previewGroups.reduce((acc, g) => acc + previewSizes.reduce((s, sz) => s + (g.sizes[sz] || 0), 0), 0)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <div className="flex gap-4">
                                <button onClick={() => setPreviewModal(false)} className="flex-1 px-6 py-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-black rounded-xl transition-colors">KEMBALI KE DRAFT</button>
                                <button onClick={handleSaveMPO} className="flex-1 px-6 py-4 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-xl transition-colors shadow-lg"><i className="fa-solid fa-check-double mr-2"></i> KONFIRMASI SIMPAN</button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {showForm && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 no-print mb-8">
                    <div className="bg-white p-8 rounded-3xl border shadow-sm flex flex-col h-[650px]">
                        <h3 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-800 border-b-2 border-slate-100 pb-4"><i className="fa-solid fa-tags text-orange-500 bg-orange-50 p-3 rounded-xl"></i> Cari Produk</h3>
                        <div className="space-y-4 mb-4">
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Tanggal PO</label>
                                    <input type="date" className="w-full p-4 border-2 border-slate-300 rounded-xl mt-1.5 font-bold text-slate-800 outline-none focus:border-orange-500 bg-slate-50" value={poDate} onChange={e => setPoDate(e.target.value)} required />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Target Selesai</label>
                                    <input type="date" className="w-full p-4 border-2 border-slate-300 rounded-xl mt-1.5 font-bold text-slate-800 outline-none focus:border-orange-500 bg-slate-50" value={targetDate} onChange={e => setTargetDate(e.target.value)} required />
                                </div>
                            </div>
                            <div className="relative">
                                <i className="fa-solid fa-search absolute left-5 top-4 text-slate-400 text-lg"></i>
                                <input type="text" placeholder="Ketik Article, Warna, Size..." className="w-full pl-14 pr-4 py-4 border-2 border-slate-300 rounded-xl text-base outline-none focus:border-orange-500 bg-slate-50 font-bold" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto border-2 border-slate-200 rounded-2xl bg-slate-50 p-2 space-y-2 shadow-inner custom-scrollbar">
                            {filteredVariants.map(v => (
                                <div key={v.sku} className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-white border-2 border-transparent rounded-xl shadow-sm hover:border-orange-400 transition-colors gap-4">
                                    <div className="flex items-center gap-4">
                                        <img src={v.photo} className="w-14 h-14 object-cover rounded-xl border shadow-sm" />
                                        <div><div className="text-base font-black text-slate-800">{v.article}</div><div className="text-xs font-bold text-slate-500 mt-1">{v.colorName} &bull; Size: <span className="text-orange-500 text-sm font-black">{v.sizeName}</span></div></div>
                                    </div>
                                    <div className="flex items-center gap-2 w-full md:w-auto">
                                        <input type="number" min="1" placeholder="Qty" value={qtys[v.sku] || 1} onChange={e => setQtys({ ...qtys, [v.sku]: parseInt(e.target.value) || 1 })} className="w-16 px-2 py-3 border-2 border-slate-300 rounded-lg text-center font-bold text-sm outline-none focus:border-orange-500 bg-slate-50" />
                                        <button type="button" onClick={() => addToDraft(v)} className="flex-1 md:flex-none bg-orange-100 text-orange-600 hover:bg-orange-500 hover:text-white transition-colors px-4 py-3 rounded-xl font-black text-xs whitespace-nowrap"><i className="fa-solid fa-plus mr-1"></i> PO</button>
                                    </div>
                                </div>
                            ))}
                            {filteredVariants.length === 0 && (
                                <div className="text-center text-sm font-bold text-slate-500 py-10">
                                    <i className="fa-solid fa-box-open text-4xl mb-3 text-slate-300 block"></i>
                                    {!query ? 'Ketik nama, warna, size, atau scan barcode untuk mencari...' : 'Produk tidak ditemukan.'}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl flex flex-col h-[650px] relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5 text-slate-400"><i className="fa-solid fa-industry text-8xl"></i></div>
                        <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4 relative z-10">
                            <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><i className="fa-solid fa-list-check text-orange-500"></i> Antrean PO (Draft: {newPoId})</h3>
                            <span className="text-white font-black bg-orange-500 px-4 py-2 rounded-xl text-sm shadow-md">{mpoDraftList.length} Item</span>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-2 mb-6 bg-slate-50 rounded-2xl p-3 shadow-inner custom-scrollbar relative z-10 border border-slate-200">
                            {mpoDraftList.map((item) => (
                                <div key={item.sku} className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <div className="text-sm text-slate-600 flex items-center gap-3">
                                        <span className="font-black text-slate-800 text-base">{item.article}</span>
                                        <span className="font-bold text-slate-500">({item.colorName} - <b className="text-orange-500">{item.sizeName}</b>)</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="font-black text-lg text-slate-800">{item.qty} Pcs</span>
                                        <button type="button" onClick={() => removeDraft(item.sku)} className="text-red-500 hover:text-white w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-red-500 rounded-xl transition-colors"><i className="fa-solid fa-trash-can text-lg"></i></button>
                                    </div>
                                </div>
                            ))}
                            {mpoDraftList.length === 0 && <div className="text-slate-400 font-medium text-sm text-center py-10">Pilih produk dari kolom di sebelah kiri</div>}
                        </div>
                        <button type="button" onClick={askPreview} disabled={mpoDraftList.length === 0} className="w-full bg-slate-900 hover:bg-black text-white py-5 rounded-2xl font-black text-xl disabled:opacity-50 transition-transform transform hover:-translate-y-1 shadow-lg shadow-slate-900/30 relative z-10"><i className="fa-regular fa-eye mr-3"></i> LIHAT PREVIEW DAFTAR PO</button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-black text-xl text-slate-800"><i className="fa-solid fa-list-ul text-orange-500 mr-2"></i> Riwayat Daftar PO</h3>
                    <span className="bg-blue-200 text-blue-900 font-black px-4 py-1.5 rounded-full text-sm shadow-inner">{mpoOrders.length} PO</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-100 text-slate-700 text-sm border-b-4 border-slate-200">
                            <tr>
                                <th className="p-5 font-black uppercase">No. PO</th>
                                <th className="p-5 font-black uppercase">Info & Target</th>
                                <th className="p-5 font-black text-center uppercase">Aksi MPO</th>
                                <th className="p-5 font-black text-right uppercase">Setting</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {mpoOrders.sort((a, b) => b.poNumber - a.poNumber).map(po => {
                                const totalOrderQty = po.items.reduce((acc, curr) => acc + curr.qty, 0);
                                const isArrived = po.status === 'ARRIVED';
                                const isShipped = po.status === 'SHIPPED';

                                return (
                                    <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-5">
                                            <div className="font-black text-xl text-slate-900">{po.id}</div>
                                            <span className={`bg-${isArrived ? 'teal' : (isShipped ? 'blue' : 'amber')}-100 text-${isArrived ? 'teal' : (isShipped ? 'blue' : 'amber')}-700 text-[10px] font-black uppercase px-2 py-1 rounded-md tracking-wider`}>{po.status}</span>
                                        </td>
                                        <td className="p-5 leading-relaxed">
                                            <div className="text-sm font-bold text-slate-700"><i className="fa-regular fa-calendar text-slate-400 mr-1"></i> PO: {po.poDate || po.createdAt?.split('T')[0] || '-'}</div>
                                            <div className="text-sm font-bold text-slate-700 mt-1"><i className="fa-regular fa-calendar-check mr-1 text-slate-400"></i> Target: {po.targetDate}</div>
                                            <div className="text-xs font-semibold text-slate-500 mt-1.5">{totalOrderQty} pcs dipesan</div>
                                        </td>
                                        <td className="p-5 text-center space-x-2">
                                            <button type="button" onClick={() => cetakMPO(po)} className="px-3 py-2 rounded-xl border bg-white text-slate-600 hover:bg-slate-100 shadow-sm transition-colors text-xs font-bold" title="Cetak Surat Pesanan">
                                                <i className="fa-solid fa-print mr-1"></i> SP
                                            </button>
                                            <button type="button" onClick={() => cetakBarcodePO(po)} disabled={isArrived} className="px-3 py-2 rounded-xl border bg-orange-100 text-orange-700 hover:bg-orange-500 hover:text-white shadow-sm transition-colors text-xs font-bold disabled:opacity-50" title="Cetak Label Barcode">
                                                <i className="fa-solid fa-barcode mr-1"></i> LBL
                                            </button>
                                        </td>
                                        <td className="p-5 text-right whitespace-nowrap">
                                            <button type="button" onClick={() => deletePO(po.id)} className="w-9 h-9 bg-white border shadow-sm rounded-xl hover:bg-rose-500 hover:text-white border-rose-200 text-rose-500 transition-colors">
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                            {mpoOrders.length === 0 && <tr><td colSpan="4" className="p-12 text-center text-slate-400 font-bold text-lg"><i className="fa-solid fa-file-invoice text-4xl block mb-3 opacity-30"></i> Belum ada pesanan pabrik.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

// ==========================================
// KOMPONEN DASHBOARD PRODUKSI (BENGKEL)
// ==========================================
function DashboardProduksi({ currentUser, mpoOrders, qcOrders, variants, transactions, activeTab, showToast, setIsLoading }) {
    const loadJsPdf = async () => {
        if (!window.jspdf) {
            await new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
        if (!window.jspdf.AutoTable) {
            await new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
    };
    const [dashView, setDashView] = useState('PO');
    const [expandedPO, setExpandedPO] = useState(null);
    const [expandedOnline, setExpandedOnline] = useState(null);
    const [isSisaFullscreen, setIsSisaFullscreen] = useState(false);
    const [selectedSessions, setSelectedSessions] = useState(new Set());
    const [auditModal, setAuditModal] = useState(null); // { sessionKey, sku, article, orders }

    const toggleSessionSelection = (sessionKey) => {
        const newSelected = new Set(selectedSessions);
        if (newSelected.has(sessionKey)) newSelected.delete(sessionKey);
        else newSelected.add(sessionKey);
        setSelectedSessions(newSelected);
    };

    const handleRekapSesi = async () => {
        if (selectedSessions.size === 0) return showToast('error', 'Pilih minimal satu sesi untuk direkap.');

        setIsLoading(true);
        try {
            // 0. Ambil Tanggal Hari Ini & Besok untuk Pewarnaan
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

            // 1. Agregasi Data (dengan Deadline Map)
            const aggregated = {};
            let selectedSessionDetails = [];
            const releasedOrderIds = new Set(); // Koleksi ID Resi yang akan dirilis ke produksi

            selectedSessions.forEach(key => {
                const group = onlineBySession[key];
                if (group && group.items) {
                    const dateObj = new Date(group.poDate);
                    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                    const dayName = dayNames[dateObj.getDay()];
                    const dateStr = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(dateObj);
                    selectedSessionDetails.push(`${dayName}, ${dateStr} (SESI ${group.session})`);

                    group.items.forEach(item => {
                        if (item.isCanceled) return;

                        // Kumpulkan ID Order untuk dirilis
                        if (item.orders) {
                            item.orders.forEach(o => releasedOrderIds.add(o.id));
                        }

                        const aggKey = `${item.article}_|_${item.colorName}_|_${item.sizeName}`;
                        if (!aggregated[aggKey]) {
                            aggregated[aggKey] = {
                                article: item.article,
                                color: item.colorName,
                                size: item.sizeName,
                                qty: 0,
                                deadlineMap: {} // { 'YYYY-MM-DD': qty }
                            };
                        }
                        aggregated[aggKey].qty += item.qty;
                        // Track per-deadline breakdown (FIX: Gunakan map jika ada rincian banyak tanggal)
                        if (item.deadlineMap && Object.keys(item.deadlineMap).length > 0) {
                            Object.entries(item.deadlineMap).forEach(([d, q]) => {
                                aggregated[aggKey].deadlineMap[d] = (aggregated[aggKey].deadlineMap[d] || 0) + q;
                            });
                        } else {
                            const dl = item.deadline || '';
                            if (dl) {
                                aggregated[aggKey].deadlineMap[dl] = (aggregated[aggKey].deadlineMap[dl] || 0) + item.qty;
                            }
                        }
                    });
                }
            });

            const parseArticleForSort = (articleName) => {
                if (!articleName) return { prefix: "", num: 0, group: 0 };
                const parts = articleName.split('-');
                const prefix = parts[0] || "";
                let num = 0;
                let group = 0;
                if (parts.length > 1) {
                    const codePart = parts.slice(1).join('-');
                    const dotParts = codePart.split('.');
                    num = parseInt(dotParts[0], 10) || 0;
                    if (dotParts.length > 1) group = parseInt(dotParts[1], 10) || 0;
                }
                return { prefix, num, group };
            };

            const finalItems = Object.values(aggregated).sort((a, b) => {
                const infoA = parseArticleForSort(a.article);
                const infoB = parseArticleForSort(b.article);
                const prefixCmp = infoA.prefix.localeCompare(infoB.prefix, undefined, { numeric: true });
                if (prefixCmp !== 0) return prefixCmp;
                if (infoA.group !== infoB.group) return infoA.group - infoB.group;
                if (infoA.num !== infoB.num) return infoA.num - infoB.num;

                const varA = variants.find(v => v.article === a.article && v.colorName === a.color);
                const varB = variants.find(v => v.article === b.article && v.colorName === b.color);
                const colA = varA ? varA.colorIndex : 999;
                const colB = varB ? varB.colorIndex : 999;
                if (colA !== colB) return colA - colB;
                return a.size.localeCompare(b.size, undefined, { numeric: true });
            });
            if (finalItems.length === 0) throw new Error('Tidak ada item aktif dalam sesi yang dipilih.');

            // Helper format deadline: 'YYYY-MM-DD' -> 'DD/MM'
            const fmtDeadline = (dateStr) => {
                if (!dateStr) return '-';
                const parts = dateStr.split('-');
                if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
                return dateStr;
            };

            // 2. Generate PDF (Match Desain User)
            await loadJsPdf();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');

            // Header
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(220, 38, 38); // Red-600
            doc.text('SISA PESANAN ONLINE FARADELA OFFICIAL', 105, 20, { align: 'center' });

            // Subheader (Tanpa Box) - Tampilkan semua sesi yang dipilih
            doc.setFontSize(11);
            doc.setFont('helvetica', 'italic');
            let subTextY = 28;
            selectedSessionDetails.forEach((detail, idx) => {
                doc.text(detail, 105, subTextY, { align: 'center' });
                subTextY += 6;
            });

            // Table
            const startY = subTextY + 5;
            // ARTICLE | COLOUR | SIZE | JUMLAH | DEADLINE
            const colWidths = [40, 38, 20, 22, 60];
            const totalTableW = colWidths.reduce((a, b) => a + b, 0); // 180
            const startX = (210 - totalTableW) / 2;

            // --- LOGIKA BARU: Helper Fungsi Header untuk Paginasi ---
            const headerH = 12;
            const drawHeader = (y) => {
                doc.setFillColor(241, 245, 249); // slate-100
                doc.rect(startX, y, totalTableW, headerH, 'F');
                doc.setDrawColor(0);
                doc.setLineWidth(0.1);
                doc.rect(startX, y, totalTableW, headerH);

                doc.setFontSize(11);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0);
                let cX = startX;
                ['ARTICLE', 'COLOUR', 'SIZE', 'JUMLAH', 'DEADLINE'].forEach((header, idx) => {
                    doc.text(header, cX + (colWidths[idx] / 2), y + 8, { align: 'center' });
                    cX += colWidths[idx];
                    if (idx < 4) doc.line(cX, y, cX, y + headerH);
                });
            };

            // Header Pertama
            drawHeader(startY);

            // Rows
            let currentY = startY + headerH;
            let totalPcs = 0;
            finalItems.forEach(item => {
                totalPcs += item.qty;

                const dlEntries = Object.entries(item.deadlineMap || {}).sort((a, b) => a[0].localeCompare(b[0]));

                // PRE-CALCULATE LINES FOR DEADLINE TO GET DYNAMIC ROW HEIGHT
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                const maxColWidth = colWidths[4] - 6; // 6mm padding
                let lines = [];
                let currentLine = [];
                let currentLineWidth = 0;

                if (dlEntries.length === 0) {
                    lines = [['-']];
                } else {
                    dlEntries.forEach(([d, q], idx) => {
                        const piece = `${fmtDeadline(d)}: ${q} pcs${idx < dlEntries.length - 1 ? ' | ' : ''}`;
                        const pieceWidth = doc.getTextWidth(piece);

                        if (currentLineWidth + pieceWidth > maxColWidth && currentLine.length > 0) {
                            lines.push(currentLine);
                            currentLine = [{ text: piece, date: d }];
                            currentLineWidth = pieceWidth;
                        } else {
                            currentLine.push({ text: piece, date: d });
                            currentLineWidth += pieceWidth;
                        }
                    });
                    if (currentLine.length > 0) lines.push(currentLine);
                }

                // Determine Dynamic Row Height
                const rowH = Math.max(11, (lines.length * 5) + 4);

                // --- LOGIKA BARU: Cek Paginasi & Render Header Ulang ---
                if (currentY + rowH > 282) {
                    doc.addPage();
                    currentY = 15; // Margin atas halaman baru
                    drawHeader(currentY);
                    currentY += headerH;
                }

                // Text Y Initial dihitung SETELAH potensi ganti halaman agar tidak tumpang tindih
                const textYInitial = currentY + 7;

                doc.rect(startX, currentY, totalTableW, rowH);
                let rowX = startX;

                // Article
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0);
                doc.text(item.article, rowX + 3, textYInitial);
                rowX += colWidths[0];
                doc.line(rowX, currentY, rowX, currentY + rowH);

                // Colour
                doc.setFont('helvetica', 'normal');
                doc.text(item.color, rowX + (colWidths[1] / 2), textYInitial, { align: 'center' });
                rowX += colWidths[1];
                doc.line(rowX, currentY, rowX, currentY + rowH);

                // Size
                doc.text(item.size, rowX + (colWidths[2] / 2), textYInitial, { align: 'center' });
                rowX += colWidths[2];
                doc.line(rowX, currentY, rowX, currentY + rowH);

                // Qty
                doc.setFont('helvetica', 'bold');
                doc.text(item.qty.toString(), rowX + (colWidths[3] / 2), textYInitial, { align: 'center' });
                rowX += colWidths[3];
                doc.line(rowX, currentY, rowX, currentY + rowH);

                // Deadline - Render Wrapped Lines
                let lineY = textYInitial;
                lines.forEach(line => {
                    let dlX = rowX + 3;
                    line.forEach(part => {
                        if (typeof part === 'string') {
                            doc.setTextColor(0);
                            doc.text(part, dlX, lineY);
                        } else {
                            const isToday = (part.date === todayStr);
                            const isTomorrow = (part.date === tomorrowStr);
                            const isLate = (part.date < todayStr && part.date !== "");
                            if (isLate) doc.setTextColor(220, 38, 38); // Merah untuk Telat
                            else if (isToday) doc.setTextColor(217, 119, 6); // Oranye/Amber untuk Hari Ini
                            else if (isTomorrow) doc.setTextColor(79, 70, 229); // Indigo untuk Persiapan Besok
                            else doc.setTextColor(0);

                            doc.text(part.text, dlX, lineY);
                            dlX += doc.getTextWidth(part.text);
                        }
                    });
                    lineY += 5;
                });
                doc.setTextColor(0); // reset

                currentY += rowH;
            });

            // Total Row (Cek Paginasi juga)
            if (currentY + 15 > 285) {
                doc.addPage();
                currentY = 15;
                drawHeader(currentY);
                currentY += headerH;
            }

            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setFillColor(248, 250, 252);
            doc.rect(startX, currentY, totalTableW, 12, 'F');
            doc.rect(startX, currentY, totalTableW, 12);
            doc.setTextColor(0);
            doc.text('TOTAL', startX + (colWidths[0] + colWidths[1] + colWidths[2]) / 2, currentY + 8, { align: 'center' });
            doc.setTextColor(220, 38, 38);
            doc.text(totalPcs.toString(), startX + colWidths[0] + colWidths[1] + colWidths[2] + (colWidths[3] / 2), currentY + 8, { align: 'center' });

            doc.save(`Rekap_SPO_Gabungan_${Date.now()}.pdf`);

            // --- LOGIKA BARU: Update Status ke Database ---
            if (releasedOrderIds.size > 0) {
                const batch = window.db.batch();
                releasedOrderIds.forEach(orderId => {
                    batch.update(window.db.collection('qc_orders').doc(orderId), { isReleasedToProduction: true, poReleasedTimestamp: Date.now() });
                });
                await batch.commit();
            }

            setSelectedSessions(new Set()); // Reset setelah rekap
            showToast('success', `Berhasil membuat Rekap SPO Gabungan dan merilis ${releasedOrderIds.size} pesanan ke produksi!`);
        } catch (err) {
            showToast('error', 'Gagal rekap: ' + err.message);
        }
        setIsLoading(false);
    };

    const cellPadding = isSisaFullscreen ? "px-1 py-1 sm:px-3 sm:py-2" : "p-3";
    const fontSize = isSisaFullscreen ? "text-[9px] sm:text-sm" : "text-sm";
    const headerFontSize = isSisaFullscreen ? "text-[10px] sm:text-sm" : "text-sm";

    const handleDeleteAntreanSku = async (sku, poDate, session) => {
        // LOGIKA BARU: Izin Akses Hapus (Admin atau Akses delete_antrean)
        const isAuthorized = currentUser?.role === 'admin' || (currentUser?.access || []).includes('delete_antrean');
        if (!isAuthorized) {
            return showToast('error', 'Hanya Admin atau staf dengan akses khusus yang bisa membatalkan antrean.');
        }

        const yakin = window.confirm(`PERINGATAN!\n\nAnda akan MEMBATALKAN antrean resi untuk:\nSKU: ${sku}\nSesi: ${session}\n\nYakin ingin membatalkan?`);
        if (!yakin) return;

        setIsLoading(true);
        try {
            const batch = window.db.batch();
            const targets = (qcOrders || []).filter(o => {
                const isPending = (o.status === 'PENDING' || o.status === 'TRANSIT') && o.isReleasedToProduction !== false;
                const hasSku = (o.items || []).some(item => (item.sysSku || item.sku || '').trim().toUpperCase() === sku);
                const matchPoDate = (o.poDate || new Date().toISOString().split('T')[0]) === poDate;
                const matchSession = (o.session || 1) === session;
                return isPending && hasSku && matchPoDate && matchSession && !o.isCanceled;
            });

            if (targets.length === 0) {
                showToast('error', 'Data tidak ditemukan untuk dibatalkan.');
            } else {
                // LOGIKA BARU: Soft Delete (Tandai sebagai DIBATALKAN, bukan dihapus permanen)
                targets.forEach(doc => batch.update(window.db.collection('qc_orders').doc(doc.id), { isCanceled: true }));
                await batch.commit();
                showToast('success', `Berhasil membatalkan ${targets.length} antrean resi.`);
            }
        } catch (err) {
            showToast('error', 'Gagal membatalkan: ' + err.message);
        }
        setIsLoading(false);
    };

    // --- COMPONENT: Modal Audit Detail ---
    const AuditModal = () => {
        if (!auditModal) return null;
        const { sessionKey, sku, article, orders } = auditModal;
        const [poDate, session] = sessionKey.split('_|_');
        const totalQty = orders.reduce((s, o) => s + o.qty, 0);

        return (
            <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-200">
                    <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <div>
                            <h3 className="font-black text-slate-800 text-lg">Audit Pesanan Online</h3>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-tight">{article} | Sesi {session} | {new Date(poDate).toLocaleDateString('id-ID')}</p>
                        </div>
                        <button onClick={() => setAuditModal(null)} className="text-slate-400 hover:text-rose-500 transition-colors"><i className="fa-solid fa-xmark text-2xl"></i></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead className="sticky top-0 bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                                <tr>
                                    <th className="p-3">No. Resi / Order</th>
                                    <th className="p-3">Platform</th>
                                    <th className="p-3 text-center">Deadline</th>
                                    <th className="p-3 text-right">Qty</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {orders.map((o, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50 text-slate-700 font-semibold">
                                        <td className="p-3 font-mono text-xs text-blue-600">{o.resi}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black ${o.platform.toLowerCase().includes('shopee') ? 'bg-orange-100 text-orange-700' :
                                                o.platform.toLowerCase().includes('tiktok') ? 'bg-slate-900 text-white' :
                                                    'bg-blue-100 text-blue-700'
                                                }`}>{o.platform}</span>
                                        </td>
                                        <td className="p-3 text-center text-xs">{o.deadline.split('-').reverse().join('/')}</td>
                                        <td className="p-3 text-right font-black">{o.qty}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                        <span className="text-sm font-bold text-slate-500 text-right">Total item diperiksa:</span>
                        <span className="text-lg font-black text-rose-600">{totalQty} Pcs</span>
                    </div>
                </div>
            </div>
        );
    };

    // FUNGSI BARU: Hapus Seluruh Sesi (Reset Antrean)
    const handleDeleteSession = async (poDate, session) => {
        const isAuthorized = currentUser?.role === 'admin' || (currentUser?.access || []).includes('delete_antrean');
        if (!isAuthorized) return showToast('error', 'Akses ditolak.');

        const labelSesi = `Sesi ${session} - ${new Date(poDate).toLocaleDateString('id-ID')}`;
        if (!window.confirm(`PERINGATAN KERAS!\n\nAnda akan membatalkan SELURUH antrean pada:\n${labelSesi}\n\nSemua barang di sesi ini akan ditandai BATAL. Lanjutkan?`)) return;

        setIsLoading(true);
        try {
            const batch = window.db.batch();
            const targets = (qcOrders || []).filter(o => {
                const isPending = (o.status === 'PENDING' || o.status === 'TRANSIT') && o.isReleasedToProduction !== false;
                const matchPoDate = (o.poDate || new Date().toISOString().split('T')[0]) === poDate;
                const matchSession = (o.session || 1) === session;
                return isPending && matchPoDate && matchSession && !o.isCanceled;
            });

            if (targets.length === 0) {
                showToast('error', 'Tidak ada antrean aktif di sesi ini.');
            } else {
                targets.forEach(doc => batch.update(window.db.collection('qc_orders').doc(doc.id), { isCanceled: true }));
                await batch.commit();
                showToast('success', `Berhasil membatalkan ${targets.length} resi pada ${labelSesi}.`);
            }
        } catch (err) {
            showToast('error', 'Gagal reset sesi: ' + err.message);
        }
        setIsLoading(false);
    };

    const filteredMpo = useMemo(() => {
        return (mpoOrders || []).map(po => {
            const fItems = (po.items || []).filter(item => {
                const variant = (variants || []).find(v => v.sku === item.sku);
                const article = variant ? (variant.article || '') : (item.article || '');
                const isF07 = article.toUpperCase().startsWith('F07');
                if (activeTab === 'samin' && !isF07) return false;
                if (activeTab === 'lery' && isF07) return false;
                return true;
            });
            return { ...po, items: fItems };
        }).filter(po => po.items.length > 0);
    }, [mpoOrders, variants, activeTab]);

    const pendingPO = filteredMpo.filter(o => o.status === 'OPEN' || o.status === 'SHIPPED')
        .reduce((acc, po) => acc + (po.items || []).reduce((s, i) => s + Math.max(0, (i.qty || 0) - (i.received || 0)), 0), 0);


    const onlineBySession = useMemo(() => {
        const groups = {};
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const sessionGroups = {};

        (qcOrders || []).filter(o =>
            (o.status === 'PENDING' || o.status === 'TRANSIT') &&
            o.isReleasedToProduction === true &&
            !o.isCanceled &&
            (o.items || []).some(it => (it.prodStatus || it.status) === 'PO')
        ).forEach(order => {
            let safeDate = todayStr;
            let sourceDate = order.deadline || order.shipDate || order.tanggalKirim || order.createdAt;

            if (sourceDate) {
                let d;
                if (sourceDate.toDate) d = sourceDate.toDate();
                else if (sourceDate.seconds) d = new Date(sourceDate.seconds * 1000);
                else if (typeof sourceDate === 'string') {
                    if (sourceDate.includes('-') && sourceDate.split('-')[0].length === 2) {
                        const parts = sourceDate.split('-');
                        safeDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    } else { safeDate = sourceDate.split('T')[0]; }
                } else d = new Date(sourceDate);

                if (d && !isNaN(d)) {
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    safeDate = `${yyyy}-${mm}-${dd}`;
                }
            }

            const poDate = order.poDate || todayStr;
            const session = order.session || 1;
            const sessionKey = `${poDate}_|_${session}`;

            if (!sessionGroups[sessionKey]) sessionGroups[sessionKey] = {};

            (order.items || []).forEach(item => {
                const sku = (item.sysSku || item.sku || '').trim().toUpperCase();
                const cleanSku = sku.split('*')[0].split('#')[0];
                const variant = (variants || []).find(v => v.sku === cleanSku);
                const article = variant ? (variant.article || '') : (item.article || '');
                const isF07 = article.toUpperCase().startsWith('F07');

                if (activeTab === 'samin' && !isF07) return;
                if (activeTab === 'lery' && isF07) return;

                if (!sessionGroups[sessionKey][sku]) {
                    sessionGroups[sessionKey][sku] = {
                        sku: sku, article: article || '-', colorName: (variant ? variant.colorName : (item.colorName || item.warna)) || '-', sizeName: (variant ? variant.sizeName : (item.sizeName || item.ukuran)) || '-',
                        demand: 0, deadline: safeDate, deadlineMap: {},
                        orders: [] // Tambahkan list order untuk fitur audit
                    };
                } else {
                    if (safeDate < sessionGroups[sessionKey][sku].deadline) {
                        sessionGroups[sessionKey][sku].deadline = safeDate;
                    }
                }

                if ((item.prodStatus || item.status) === 'PO') {
                    const q = Number(item.qty || 0);
                    sessionGroups[sessionKey][sku].demand += q;
                    if (!sessionGroups[sessionKey][sku].deadlineMap) sessionGroups[sessionKey][sku].deadlineMap = {};
                    sessionGroups[sessionKey][sku].deadlineMap[safeDate] = (sessionGroups[sessionKey][sku].deadlineMap[safeDate] || 0) + q;

                    // Simpan detail order untuk audit
                    sessionGroups[sessionKey][sku].orders.push({
                        id: order.id,
                        resi: order.id_pesanan || order.resi || 'MANUAL',
                        platform: order.platform || order.sumber || 'Gudang',
                        qty: q,
                        deadline: safeDate
                    });
                }
            });
        });

        Object.keys(sessionGroups).sort().forEach(key => {
            const [poDate, session] = key.split('_|_');
            Object.values(sessionGroups[key]).forEach(data => {
                if (data.demand > 0) {
                    if (!groups[key]) groups[key] = { poDate, session: parseInt(session), items: [] };
                    groups[key].items.push({ ...data, qty: data.demand, isToday: data.deadline <= todayStr, isCanceled: false });
                }
            });
        });

        // PERBAIKAN: Hilangkan Sesi yang isinya kosong atau sisa Pcs-nya 0 agar tidak memenuhi layar bengkel
        const filteredGroups = {};
        Object.keys(groups).forEach(key => {
            const sessionItems = groups[key] && Array.isArray(groups[key].items) ? groups[key].items : [];
            const sessionTotal = sessionItems.reduce((s, it) => s + it.qty, 0);

            if (sessionItems.length > 0 && sessionTotal > 0) {
                sessionItems.sort((a, b) => {
                    if (a.article !== b.article) return (a.article || '').localeCompare(b.article || '');
                    if (a.colorName !== b.colorName) return (a.colorName || '').localeCompare(b.colorName || '');
                    const sizeA = parseInt(a.sizeName) || 0;
                    const sizeB = parseInt(b.sizeName) || 0;
                    return sizeA - sizeB;
                });
                filteredGroups[key] = groups[key];
            }
        });

        return filteredGroups;
    }, [qcOrders, variants, transactions, activeTab]);

    // Hitung total sisa pesanan online (Tidak termasuk yang dibatalkan)
    const pendingOnline = Object.values(onlineBySession).reduce((acc, group) => {
        if (group && Array.isArray(group.items)) {
            return acc + group.items.filter(i => !i.isCanceled).reduce((s, i) => s + i.qty, 0);
        }
        return acc;
    }, 0);

    const mpoToDisplay = filteredMpo.filter(o => o.status === 'OPEN' || o.status === 'SHIPPED');

    return (
        <div className="bg-white p-6 rounded-3xl border shadow-sm mb-6 no-print animate-in zoom-in duration-300">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-black text-slate-800"><i className="fa-solid fa-industry text-orange-600 mr-2"></i> Target Produksi {activeTab === 'lery' ? "Lery's Workshop (F01)" : 'Pak Samin (F07)'}</h3>
                {(dashView === 'ONLINE' || dashView === 'PO') && (
                    <button onClick={() => setIsSisaFullscreen(!isSisaFullscreen)} className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-rose-100 text-rose-600 rounded-xl font-black hover:bg-rose-600 hover:text-white transition-all shadow-sm text-xs sm:text-sm">
                        <i className={`fa-solid ${isSisaFullscreen ? 'fa-compress' : 'fa-expand'}`}></i>
                        {isSisaFullscreen ? 'Tutup' : 'Layar Penuh'}
                    </button>
                )}
            </div>
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div onClick={() => setDashView('PO')} className={`cursor-pointer p-4 rounded-2xl border-2 transition-all ${dashView === 'PO' ? 'bg-orange-50 border-orange-500 shadow-md' : 'bg-slate-50 border-slate-200 hover:border-orange-300'}`}>
                    <div className="text-xs font-black text-slate-500 uppercase">Sisa PO Bengkel</div>
                    <div className="text-3xl font-black text-orange-600 mt-1">{pendingPO} <span className="text-sm font-bold text-slate-500">Pcs</span></div>
                </div>
                <div onClick={() => setDashView('ONLINE')} className={`cursor-pointer p-4 rounded-2xl border-2 transition-all ${dashView === 'ONLINE' ? 'bg-rose-50 border-rose-500 shadow-md' : 'bg-slate-50 border-slate-200 hover:border-rose-300'}`}>
                    <div className="text-xs font-black text-slate-500 uppercase">Sisa Online (Prioritas)</div>
                    <div className="text-3xl font-black text-rose-600 mt-1">{pendingOnline} <span className="text-sm font-bold text-slate-500">Pcs</span></div>
                </div>
            </div>

            {/* ... (TABEL PO DIBIARKAN SAMA PERSIS) ... */}
            {dashView === 'PO' && (
                <div className={isSisaFullscreen ? "fixed inset-0 z-[9999] bg-white p-2 sm:p-6 overflow-y-auto" : "relative border-t pt-4"}>
                    {isSisaFullscreen && (
                        <div className="flex justify-between items-center mb-4 bg-orange-50 p-3 rounded-xl border-2 border-orange-200">
                            <h3 className="text-sm sm:text-lg font-black text-orange-700 uppercase flex items-center gap-2"><i className="fa-solid fa-expand text-base"></i> Mode Fokus PO</h3>
                            <button onClick={() => setIsSisaFullscreen(false)} className="bg-orange-600 text-white px-4 py-2 rounded-lg text-xs font-black shadow-md hover:bg-orange-700">
                                <i className="fa-solid fa-compress mr-1"></i> TUTUP
                            </button>
                        </div>
                    )}
                    <div className={`space-y-4 ${!isSisaFullscreen ? 'max-h-[500px]' : ''} overflow-y-auto custom-scrollbar pr-2`}>
                        {mpoToDisplay.map((po) => {
                            const poItems = po.items || [];
                            const totalQty = poItems.reduce((sum, i) => sum + (i.qty || 0), 0);
                            const totalReceived = poItems.reduce((sum, i) => sum + (i.received || 0), 0);
                            const isDone = totalReceived >= totalQty && totalQty > 0;
                            const isExpanded = expandedPO === po.id;
                            const sizes = [...new Set(poItems.map(i => i.sizeName || '-'))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                            const articleGroups = {};
                            poItems.forEach(item => {
                                if (!articleGroups[item.article]) articleGroups[item.article] = {};
                                if (!articleGroups[item.article][item.colorName]) articleGroups[item.article][item.colorName] = {};
                                if (!articleGroups[item.article][item.colorName][item.sizeName]) articleGroups[item.article][item.colorName][item.sizeName] = { qty: 0, received: 0 };
                                articleGroups[item.article][item.colorName][item.sizeName].qty += (item.qty || 0);
                                articleGroups[item.article][item.colorName][item.sizeName].received += (item.received || 0);
                            });
                            return (
                                <div key={po.id} className="bg-white border rounded-2xl shadow-sm overflow-hidden">
                                    <div onClick={() => setExpandedPO(isExpanded ? null : po.id)} className="p-4 cursor-pointer hover:bg-slate-50 transition-colors flex justify-between items-center bg-orange-50/30">
                                        <div>
                                            <div className="font-black text-lg text-slate-800"><i className="fa-solid fa-file-invoice mr-2 text-orange-500"></i>PO {po.poNumber} <span className="text-sm font-bold text-slate-500 ml-2">({po.targetDate})</span></div>
                                            <div className="text-sm font-bold mt-1 ml-6">{isDone ? <span className="text-teal-600"><i className="fa-solid fa-check-double mr-1"></i>Selesai Diterima ({totalReceived}/{totalQty})</span> : <span className="text-orange-600">Diterima Gudang: {totalReceived} / {totalQty} Pcs <span className="text-xs bg-rose-100 text-rose-600 px-2 py-0.5 rounded-md ml-2 border border-rose-200 font-black">Kurang {totalQty - totalReceived}</span></span>}</div>
                                        </div>
                                        <div className="text-slate-400 bg-white w-10 h-10 flex items-center justify-center rounded-full border shadow-sm"><i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-xl`}></i></div>
                                    </div>
                                    {isExpanded && (
                                        <div className="overflow-x-auto bg-white border-t border-slate-200">
                                            <table className={`w-full ${fontSize} text-left`}>
                                                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                                                    <tr>
                                                        <th className={`${cellPadding} font-black border-r border-slate-100`}>ARTICLE</th>
                                                        <th className={`${cellPadding} font-black text-center border-r border-slate-100`}>WARNA</th>
                                                        {sizes.map(sz => <th key={sz} className={`${cellPadding} font-black text-center text-orange-600`}>{sz}</th>)}
                                                        <th className={`${cellPadding} font-black text-center bg-orange-50`}>DITRM</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {Object.keys(articleGroups).sort().map((article) => {
                                                        const colors = Object.keys(articleGroups[article]).sort();
                                                        return colors.map((color, cIdx) => {
                                                            const rowTotal = sizes.reduce((sum, sz) => sum + (articleGroups[article][color][sz]?.qty || 0), 0);
                                                            const rowReceived = sizes.reduce((sum, sz) => sum + (articleGroups[article][color][sz]?.received || 0), 0);
                                                            const isRowDone = rowReceived >= rowTotal && rowTotal > 0;
                                                            return (
                                                                <tr key={`${article}-${color}`} className={`hover:bg-slate-50 ${isRowDone ? 'bg-teal-50/30' : ''}`}>
                                                                    {cIdx === 0 && <td rowSpan={colors.length} className={`${cellPadding} font-black text-slate-800 border-r border-slate-100 bg-white align-middle`}>{article}</td>}
                                                                    <td className={`${cellPadding} font-bold text-slate-600 text-center border-r border-slate-100`}>{color}</td>
                                                                    {sizes.map(sz => {
                                                                        const cell = articleGroups[article][color][sz];
                                                                        if (!cell || cell.qty === 0) return <td key={sz} className={`${cellPadding} text-center text-slate-300 border-r border-slate-100`}>-</td>;
                                                                        const isCellDone = cell.received >= cell.qty;
                                                                        return <td key={sz} className={`${cellPadding} text-center font-bold border-r border-slate-100`}>{isCellDone ? <span className="text-teal-500">{cell.qty}</span> : <span><span className="text-orange-600 font-black">{cell.received}</span><span className="text-slate-400">/{cell.qty}</span></span>}</td>;
                                                                    })}
                                                                    <td className={`${cellPadding} text-center font-black bg-orange-50/50`}>{isRowDone ? <span className="text-teal-600">{rowTotal}</span> : <span><span className="text-orange-600">{rowReceived}</span><span className="text-slate-400">/{rowTotal}</span></span>}</td>
                                                                </tr>
                                                            );
                                                        });
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {dashView === 'ONLINE' && (
                <div className={isSisaFullscreen ? "fixed inset-0 z-[9999] bg-white p-2 sm:p-6 overflow-y-auto" : "relative border-t pt-4"}>
                    {isSisaFullscreen && (
                        <div className="flex justify-between items-center mb-4 bg-rose-50 p-3 rounded-xl border-2 border-rose-200">
                            <h3 className="text-sm sm:text-lg font-black text-rose-700 uppercase flex items-center gap-2"><i className="fa-solid fa-expand text-base"></i> Mode Fokus Sisa Online</h3>
                            <button onClick={() => setIsSisaFullscreen(false)} className="bg-rose-600 text-white px-4 py-2 rounded-lg text-xs font-black shadow-md hover:bg-rose-700">
                                <i className="fa-solid fa-compress mr-1"></i> TUTUP
                            </button>
                        </div>
                    )}
                    <div className="flex justify-between items-center mb-4 px-2 no-print">
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-3 py-1 rounded-lg">
                            {selectedSessions.size > 0 ? <><i className="fa-solid fa-square-check text-rose-500 mr-1"></i> {selectedSessions.size} Sesi Dipilih</> : 'Pilih sesi untuk direkap'}
                        </div>
                        <button
                            onClick={handleRekapSesi}
                            disabled={selectedSessions.size === 0}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black transition-all shadow-md text-sm ${selectedSessions.size > 0 ? 'bg-orange-600 text-white hover:bg-orange-700 active:scale-95' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                        >
                            <i className="fa-solid fa-file-pdf"></i> REKAP SESI TERPILIH
                        </button>
                    </div>
                    <div className={`space-y-6 ${!isSisaFullscreen ? 'max-h-[500px]' : ''} overflow-y-auto custom-scrollbar pr-2`}>
                        {Object.keys(onlineBySession).sort().map((sessionKey, i) => {
                            const group = onlineBySession[sessionKey];
                            if (!group || !group.items) return null;

                            const poDateStr = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(group.poDate));
                            const sessionTotal = group.items.filter(i => !i.isCanceled).reduce((s, it) => s + it.qty, 0);
                            const hasUrgent = group.items.some(it => it.isToday && !it.isCanceled);

                            // LOGIKA BARU: Cek apakah kotak ini sedang diklik terbuka
                            const isExpanded = expandedOnline === sessionKey;

                            return (
                                <div key={i} className={`border-2 rounded-2xl overflow-hidden shadow-sm relative ${hasUrgent ? 'border-red-300' : 'border-rose-200'}`}>

                                    {/* LOGIKA BARU: Tambahkan onClick dan ganti cursor jadi pointer, serta tambahkan Panah (Chevron) */}
                                    <div onClick={() => setExpandedOnline(isExpanded ? null : sessionKey)} className={`cursor-pointer hover:bg-slate-50 transition-colors p-4 font-bold flex justify-between items-center text-sm ${hasUrgent ? 'bg-rose-50 border-b border-rose-200' : 'bg-slate-50 border-b border-slate-200'}`}>
                                        <div className="flex items-center gap-4">
                                            {/* CHECKBOX SELEKSI */}
                                            <div
                                                onClick={(e) => { e.stopPropagation(); toggleSessionSelection(sessionKey); }}
                                                className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shadow-sm ${selectedSessions.has(sessionKey) ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-slate-300 text-transparent hover:border-rose-400'}`}
                                                title="Pilih untuk Rekap"
                                            >
                                                <i className="fa-solid fa-check text-[10px]"></i>
                                            </div>

                                            <div className="flex items-center gap-3 border-l pl-4 border-slate-200">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${hasUrgent ? 'bg-rose-500' : 'bg-slate-700'}`}>
                                                    <i className="fa-solid fa-boxes-stacked text-lg"></i>
                                                </div>
                                                <div>
                                                    <div className={hasUrgent ? 'text-rose-700 text-base' : 'text-slate-700 text-base'}>Sesi {group.session} &bull; {poDateStr}</div>
                                                    <div className="text-xs text-slate-500 mt-0.5"><i className="fa-solid fa-clock-rotate-left mr-1"></i>Menunggu: {sessionTotal} Pcs</div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {hasUrgent && <span className="bg-red-500 text-white text-[11px] px-3 py-1 rounded-lg uppercase tracking-wider shadow-sm animate-pulse"><i className="fa-solid fa-fire mr-1"></i>Mendesak Hari Ini</span>}


                                            {/* TOMBOL RESET SESI (Hapus Semua dalam Sesi ini) */}
                                            {(currentUser?.role === 'admin' || (currentUser?.access || []).includes('delete_antrean')) && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(group.poDate, group.session); }}
                                                    className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center shadow-sm border border-rose-200"
                                                    title="Batalkan Seluruh Sesi Ini"
                                                >
                                                    <i className="fa-solid fa-trash-arrow-up text-xs"></i>
                                                </button>
                                            )}

                                            <div className="text-slate-400 bg-white w-8 h-8 flex items-center justify-center rounded-full border shadow-sm">
                                                <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                                            </div>
                                        </div>
                                    </div>

                                    {/* LOGIKA BARU: Tabelnya disembunyikan dan baru muncul kalau isExpanded = true */}
                                    {isExpanded && (
                                        <div className="overflow-x-auto bg-white">
                                            <table className={`w-full ${fontSize} text-left bg-white`}>
                                                <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                                                    <tr>
                                                        <th className={`${cellPadding} font-black text-left border-r border-slate-200`}>ARTICLE</th>
                                                        <th className={`${cellPadding} font-black text-left border-r border-slate-200`}>WARNA</th>
                                                        <th className={`${cellPadding} font-black text-center border-r border-slate-200`}>SIZE</th>
                                                        <th className={`${cellPadding} font-black text-center border-r border-slate-200`}>SISA</th>
                                                        <th className={`${cellPadding} font-black text-center text-slate-500`}>TGL</th>
                                                        <th className={`${cellPadding} font-black text-center text-slate-500`}>AKSI</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {group.items.map((it, j) => {
                                                        const nowStr = new Date();
                                                        const curStr = `${nowStr.getFullYear()}-${String(nowStr.getMonth() + 1).padStart(2, '0')}-${String(nowStr.getDate()).padStart(2, '0')}`;
                                                        const tomDate = new Date(nowStr);
                                                        tomDate.setDate(nowStr.getDate() + 1);
                                                        const tomStr = `${tomDate.getFullYear()}-${String(tomDate.getMonth() + 1).padStart(2, '0')}-${String(tomDate.getDate()).padStart(2, '0')}`;

                                                        let isLate = it.deadline < curStr;
                                                        let isNow = it.deadline === curStr;
                                                        let isTomorrow = it.deadline === tomStr;
                                                        return (
                                                            <tr key={j} className={`hover:bg-slate-50 border-b border-slate-100 last:border-0 ${it.isCanceled ? 'opacity-60 bg-slate-50' : ''}`}>
                                                                <td className={`${cellPadding} font-black text-slate-800 border-r border-slate-100`}>{it.article}</td>
                                                                <td className={`${cellPadding} font-bold text-slate-600 border-r border-slate-100`}>{it.colorName}</td>
                                                                <td className={`${cellPadding} font-black text-slate-800 text-center border-r border-slate-100`}>{it.sizeName}</td>
                                                                <td className={`${cellPadding} text-center font-bold border-r border-slate-100`}>
                                                                    {it.isCanceled ? (
                                                                        <span className={`${isSisaFullscreen ? 'text-[9px]' : 'text-xs'} text-slate-500 bg-slate-200 px-1 py-0.5 rounded font-black border border-slate-300 line-through`}>{it.qty}</span>
                                                                    ) : (
                                                                        <span className={`${isSisaFullscreen ? 'text-[9px]' : 'text-xs'} text-rose-600 bg-rose-50 px-1 py-0.5 rounded font-black border border-rose-200 shadow-sm`}>{it.qty}</span>
                                                                    )}
                                                                </td>
                                                                <td className={`${cellPadding} text-center font-bold border-r border-slate-100`}>
                                                                    {it.isCanceled ? (
                                                                        <span className="text-[9px] uppercase font-black tracking-wider px-1 py-0.5 rounded shadow-sm bg-slate-200 text-slate-500">BATAL</span>
                                                                    ) : (
                                                                        <div className="flex flex-col items-center gap-0.5">
                                                                            <span className={`text-[9px] uppercase font-black tracking-wider px-1 py-0.5 rounded shadow-sm border ${isNow ? 'bg-red-100 border-red-300 text-red-600 animate-pulse' : (isLate ? 'bg-red-500 border-red-600 text-white animate-pulse' : (isTomorrow ? 'bg-indigo-100 border-indigo-200 text-indigo-600' : 'bg-slate-100 border-slate-200 text-slate-500'))}`}>
                                                                                {isNow ? 'SKRG' : (isLate ? `TELAT` : (isTomorrow ? 'BSK' : it.deadline.split('-').slice(1).join('/')))}
                                                                            </span>
                                                                            {it.deadlineMap && Object.keys(it.deadlineMap).length > 1 && (
                                                                                <span className="text-[8px] font-black text-orange-600 bg-orange-50 px-1 rounded border border-orange-100 leading-tight">+{Object.keys(it.deadlineMap).length - 1} tgl</span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className={`${cellPadding} text-center`}>
                                                                    <div className="flex justify-center items-center gap-1.5">
                                                                        {!it.isCanceled && (
                                                                            <button
                                                                                onClick={() => setAuditModal({ sessionKey, sku: it.sku, article: it.article, orders: it.orders })}
                                                                                className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-all border border-blue-200 flex items-center justify-center"
                                                                                title="Detail Audit Pesanan"
                                                                            >
                                                                                <i className="fa-solid fa-magnifying-glass text-[10px]"></i>
                                                                            </button>
                                                                        )}
                                                                        {!it.isCanceled && (currentUser?.role === 'admin' || (currentUser?.access || []).includes('delete_antrean')) ? (
                                                                            <button onClick={() => handleDeleteAntreanSku(it.sku, group.poDate, group.session)} className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all border border-rose-200 flex items-center justify-center" title="Batalkan Pesanan">
                                                                                <i className="fa-solid fa-trash-can text-[10px]"></i>
                                                                            </button>
                                                                        ) : (
                                                                            it.isCanceled ? <i className="fa-solid fa-ban text-slate-300" title="Sudah Dibatalkan"></i> : (!it.isCanceled && <i className="fa-solid fa-lock text-slate-300" title="Hanya Admin yang bisa menghapus"></i>)
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {Object.keys(onlineBySession).length === 0 && <div className="text-center p-8 text-slate-400 font-bold border-2 border-dashed border-slate-300 rounded-xl">Mantap! Tidak ada antrean prioritas Online saat ini.</div>}
                    </div>
                </div>
            )}
            <AuditModal />
        </div>
    );
}

// ==========================================
// PRODUKSI BENGKEL DIGITAL (LERY, SAMIN, & FARADELA)
// ==========================================
function CekSuratJalan({ currentUser, mpoOrders, qcOrders, variants, transactions, showToast, setIsLoading }) {
    // Cek izin akses 3 Cabang
    const canLery = currentUser?.role === 'admin' || (currentUser?.access || []).includes('sj_lery');
    const canSamin = currentUser?.role === 'admin' || (currentUser?.access || []).includes('sj_samin');
    const canFaradela = currentUser?.role === 'admin' || (currentUser?.access || []).includes('sj_faradela');

    // Set tab default
    const [activeTab, setActiveTab] = useState(canLery ? 'lery' : (canSamin ? 'samin' : 'faradela'));

    // ==== SCANNER STATE (UNIFIED) ====
    const [showScanner, setShowScanner] = useState(false);
    const [scannerType, setScannerType] = useState(null);
    const [scannerLabel, setScannerLabel] = useState('');
    const lastScanRef = useRef({ text: '', time: 0 });

    // ---- PENGIRIM STATE (Lery & Samin) ----
    const [activeSender, setActiveSender] = useState(null);
    const [senderIdInput, setSenderIdInput] = useState('');
    const [tglKirim, setTglKirim] = useState(new Date().toISOString().split('T')[0]);
    const [scanInputPengirim, setScanInputPengirim] = useState('');
    const [scanCategoryPengirim, setScanCategoryPengirim] = useState('Penjualan (Off + Online)'); // Default kategori OUT
    const [scannedItemsPengirim, setScannedItemsPengirim] = useState({});
    const [scannedTypePengirim, setScannedTypePengirim] = useState({});
    const scanRefPengirim = useRef(null);
    const senderIdRef = useRef(null);

    // ---- PENERIMA STATE (Faradela) ----
    const [activeReceiver, setActiveReceiver] = useState(null);
    const [receiverIdInput, setReceiverIdInput] = useState('');
    const [activeDraft, setActiveDraft] = useState(null);
    const [scanInputPenerima, setScanInputPenerima] = useState('');
    const [scanCategoryPenerima, setScanCategoryPenerima] = useState('PO Nota'); // Default kategori IN
    const [scannedItemsPenerima, setScannedItemsPenerima] = useState({});
    const [draftConfirmed, setDraftConfirmed] = useState(false);
    const scanRefPenerima = useRef(null);
    const receiverIdRef = useRef(null);

    const draftSJs = mpoOrders.filter(o => o.status === 'SHIPPED' || o.status === 'SJ_CONFIRMED');

    const parseSku = (raw) => parseGlobalSku(raw, variants);
    const detectBarcodeType = detectGlobalBarcodeType;

    const beep = (ok) => {
        const url = ok
            ? 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
            : 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3';
        new Audio(url).play().catch(() => { });
    };

    // -------- ID CARD SCAN HANDLERS --------
    const handleScanSenderId = async (e, valFromCam) => {
        if (e) e.preventDefault();
        const val = valFromCam || senderIdInput.trim();
        if (!val) return;
        try {
            const snap = await db.collection('employees').where('idKaryawan', '==', val).limit(1).get();
            if (snap.empty) { beep(false); showToast('error', `ID Card "${val}" tidak ditemukan!`); return; }
            const emp = snap.docs[0].data();
            setActiveSender(emp);
            setSenderIdInput('');
            beep(true);
            showToast('success', `✅ Terverifikasi: ${emp.nama}`);
            if (valFromCam) setShowScanner(false);
        } catch (err) { showToast('error', 'Gagal verifikasi ID: ' + err.message); }
    };

    const handleScanReceiverId = async (e, valFromCam) => {
        if (e) e.preventDefault();
        const val = valFromCam || receiverIdInput.trim();
        if (!val) return;
        try {
            const snap = await db.collection('employees').where('idKaryawan', '==', val).limit(1).get();
            if (snap.empty) { beep(false); showToast('error', `ID Card "${val}" tidak ditemukan!`); return; }
            const emp = snap.docs[0].data();
            setActiveReceiver(emp);
            setReceiverIdInput('');
            beep(true);
            showToast('success', `✅ Terverifikasi: ${emp.nama}`);
            if (valFromCam) setShowScanner(false);
        } catch (err) { showToast('error', 'Gagal verifikasi ID: ' + err.message); }
    };

    const openScanner = (type, label) => {
        setScannerType(type);
        setScannerLabel(label);
        setShowScanner(true);
    };

    useEffect(() => {
        let scanner = null;
        if (showScanner) {
            const initScanner = () => {
                if (!window.Html5QrcodeScanner) return;
                scanner = new window.Html5QrcodeScanner('reader-surat-jalan', {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0
                }, false);

                scanner.render((text) => {
                    const now = Date.now();
                    if (lastScanRef.current.text === text && now - lastScanRef.current.time < 2000) return;
                    lastScanRef.current = { text, time: now };

                    if (scannerType === 'senderId') handleScanSenderId(null, text);
                    else if (scannerType === 'receiverId') handleScanReceiverId(null, text);
                    else if (scannerType === 'itemsPengirim') processScanPengirim(text);
                    else if (scannerType === 'itemsPenerima') processScanPenerima(text);
                }, (err) => { });
            };

            if (!window.Html5QrcodeScanner) {
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/html5-qrcode';
                script.onload = initScanner;
                document.head.appendChild(script);
            } else {
                setTimeout(initScanner, 100);
            }
        }
        return () => { if (scanner) scanner.clear().catch(e => console.log(e)); };
    }, [showScanner, scannerType]);


    // LOGIKA PENGIRIM (DILENGKAPI PROTEKSI F01 / F07)
    const processScanPengirim = (raw) => {
        if (!activeSender) { showToast('error', 'Scan ID Card Pengirim terlebih dahulu!'); return; }
        const fullBarcode = raw.trim().toUpperCase();
        const itemType = detectBarcodeType(fullBarcode);

        if (itemType === 'UNKNOWN') {
            beep(false);
            showToast('error', 'Barcode tidak valid! Harus dari label sistem (* atau #).');
            return;
        }

        const sku = parseSku(fullBarcode);
        const variantExists = (variants || []).find(v => v.sku === sku);
        if (!variantExists) {
            beep(false);
            showToast('error', `DITOLAK! Barang tidak terdaftar di Master Produk.`);
            return;
        }

        // ==========================================
        // VALIDASI PABRIK (LERY vs SAMIN)
        // ==========================================
        const isF07 = variantExists.article.toUpperCase().startsWith('F07-');
        if (activeTab === 'lery' && isF07) {
            beep(false);
            showToast('error', `DITOLAK! Lery Workshop (F01) tidak memproduksi artikel F07.`);
            return;
        }
        if (activeTab === 'samin' && !isF07) {
            beep(false);
            showToast('error', `DITOLAK! Pak Samin (F07) HANYA memproduksi artikel F07.`);
            return;
        }

        if (itemType === 'ONLINE') {
            const sessionStr = fullBarcode.split('*')[1];
            if (!sessionStr || sessionStr.length > 2 || isNaN(parseInt(sessionStr, 10))) {
                beep(false);
                showToast('error', `DITOLAK! Format sesi online salah (*${sessionStr})`);
                return;
            }
        } else if (itemType === 'PO') {
            const poStr = fullBarcode.split('#')[1];
            const poNum = fullBarcode.startsWith('$') ? parseInt(poStr, 36) : parseInt(poStr, 10);
            const poExists = (mpoOrders || []).find(o => o.poNumber === poNum);
            if (!poExists) {
                beep(false);
                showToast('error', `DITOLAK! PO Pabrik #${poStr} (Decoded: ${poNum}) tidak ditemukan.`);
                return;
            }
        }

        setScannedItemsPengirim(prev => ({ ...prev, [fullBarcode]: (prev[fullBarcode] || 0) + 1 }));
        setScannedTypePengirim(prev => ({ ...prev, [fullBarcode]: itemType }));
        beep(true);
        setScanInputPengirim('');
        if (scanRefPengirim.current) scanRefPengirim.current.focus();
    };

    const handleScanFormPengirim = (e) => {
        e.preventDefault();
        if (!scanInputPengirim.trim()) return;
        processScanPengirim(scanInputPengirim);
    };

    const handleKirimSJ = async () => {
        if (!activeSender) return showToast('error', 'Scan ID Card pengirim terlebih dahulu!');
        if (Object.keys(scannedItemsPengirim).length === 0) return showToast('error', 'Belum ada barang yang discan!');
        setIsLoading(true);
        try {
            const sjItems = Object.entries(scannedItemsPengirim).map(([barcode, qty]) => {
                const sku = parseSku(barcode);
                const variant = (variants || []).find(v => v.sku === sku);
                return {
                    fullBarcode: barcode, sku: sku, qty: qty,
                    itemType: scannedTypePengirim[barcode] || 'UNKNOWN',
                    article: variant ? variant.article : '-', colorName: variant ? variant.colorName : '-', sizeName: variant ? variant.sizeName : '-',
                };
            });

            const sjId = 'SJ-' + Date.now();
            const batch = db.batch();

            // Tandai Workshop yang mengirim
            const workshopName = activeTab === 'lery' ? "Lery's Workshop (F01)" : 'Pak Samin (F07)';

            batch.set(db.collection('surat_jalan').doc(sjId), {
                id: sjId, status: 'SHIPPED', createdAt: new Date().toISOString(),
                workshop: workshopName,
                tglKirim: tglKirim, namaPengirim: activeSender.nama,
                pengirimId: activeSender.idKaryawan, pengirimPosisi: activeSender.posisi,
                items: sjItems, totalPcs: sjItems.reduce((a, c) => a + c.qty, 0),
            });

            const mpoUpdates = {};
            for (const [barcode, qty] of Object.entries(scannedItemsPengirim)) {
                if (barcode.includes('#')) {
                    const poNumber = parseInt(barcode.split('#')[1], 10);
                    if (!mpoUpdates[poNumber]) mpoUpdates[poNumber] = {};
                    const sku = parseSku(barcode);
                    mpoUpdates[poNumber][sku] = (mpoUpdates[poNumber][sku] || 0) + qty;
                }
            }

            for (const poNum of Object.keys(mpoUpdates)) {
                const poDoc = (mpoOrders || []).find(o => o.poNumber === parseInt(poNum, 10));
                if (poDoc) {
                    const newItems = (poDoc.items || []).map(pit => {
                        const safeSku = (pit.sku || '').trim().toUpperCase();
                        const addQty = mpoUpdates[poNum][safeSku] || 0;
                        return { ...pit, shipped: (pit.shipped || 0) + addQty };
                    });
                    batch.update(db.collection('purchase_orders').doc(poDoc.id), { items: newItems });
                }
            }

            await batch.commit();

            beep(true);
            showToast('success', `Surat Jalan ${sjId} berhasil dikirim oleh ${activeSender.nama}!`);
            setScannedItemsPengirim({});
            setScannedTypePengirim({});
        } catch (err) {
            showToast('error', 'Gagal mengirim SJ: ' + err.message);
        }
        setIsLoading(false);
    };

    // -------- PENERIMA LOGIC --------
    const [suratJalanList, setSuratJalanList] = useState([]);
    useEffect(() => {
        const unsub = db.collection('surat_jalan').orderBy('createdAt', 'desc').onSnapshot(snap => {
            setSuratJalanList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, err => console.log(err));
        return () => unsub();
    }, []);

    const processScanPenerima = (raw) => {
        if (!activeReceiver) { showToast('error', 'Scan ID Card Penerima terlebih dahulu!'); return; }
        if (!activeDraft) { showToast('error', 'Pilih Surat Jalan yang ingin diverifikasi!'); return; }

        const fullBarcode = raw.trim().toUpperCase();
        const itemType = detectBarcodeType(fullBarcode);

        if (itemType === 'UNKNOWN') {
            beep(false);
            showToast('error', 'Barcode tidak valid! Harus mengandung * atau #');
            return;
        }

        const sku = parseSku(fullBarcode);

        if (itemType === 'ONLINE') {
            const sessionStr = fullBarcode.split('*')[1];
            if (!sessionStr || sessionStr.length > 2 || isNaN(parseInt(sessionStr, 10))) {
                beep(false);
                showToast('error', `DITOLAK! Format sesi online salah / kelebihan angka (*${sessionStr})`);
                return;
            }
        } else if (itemType === 'PO') {
            const poStr = fullBarcode.split('#')[1];
            const poNum = fullBarcode.startsWith('$') ? parseInt(poStr, 36) : parseInt(poStr, 10);
            if (isNaN(poNum)) {
                beep(false);
                showToast('error', `DITOLAK! Format PO salah (#${poStr})`);
                return;
            }
        }

        let matchedItem = (activeDraft.items || []).find(i => i.fullBarcode === fullBarcode);
        if (!matchedItem) {
            matchedItem = (activeDraft.items || []).find(i => i.sku === sku && i.itemType === itemType);
        }

        if (!matchedItem) {
            beep(false);
            showToast('error', `Barang ini tidak ada di daftar Surat Jalan!`);
            return;
        }

        const matchedKey = matchedItem.fullBarcode;
        const currentScanned = scannedItemsPenerima[matchedKey] || 0;
        const maxQty = matchedItem.qty;

        if (currentScanned >= maxQty) {
            beep(false);
            showToast('error', 'Jumlah barang ini sudah pas/lengkap!');
            return;
        }

        setScannedItemsPenerima(prev => ({ ...prev, [matchedKey]: currentScanned + 1 }));
        beep(true);
        setScanInputPenerima('');
        if (scanRefPenerima.current) scanRefPenerima.current.focus();
    };

    const handleScanFormPenerima = (e) => {
        e.preventDefault();
        if (!scanInputPenerima.trim()) return;
        processScanPenerima(scanInputPenerima);
    };

    const handleKonfirmasi = async () => {
        if (!activeDraft) return;
        if (!activeReceiver) return showToast('error', 'Scan ID Card Penerima terlebih dahulu!');
        if (Object.keys(scannedItemsPenerima).length === 0) return showToast('error', 'Belum ada barang di-scan!');
        setIsLoading(true);
        try {
            const batch = db.batch();

            batch.update(db.collection('surat_jalan').doc(activeDraft.id), {
                status: 'SJ_CONFIRMED', confirmedAt: new Date().toISOString(),
                namaPenerima: activeReceiver.nama, penerimaId: activeReceiver.idKaryawan,
                penerimaPosisi: activeReceiver.posisi, scanReceived: scannedItemsPenerima
            });

            const mpoUpdates = {};
            for (const [barcode, qty] of Object.entries(scannedItemsPenerima)) {
                if (barcode.includes('#')) {
                    const poNumber = parseInt(barcode.split('#')[1], 10);
                    if (!mpoUpdates[poNumber]) mpoUpdates[poNumber] = {};
                    const cleanSku = parseSku(barcode);
                    mpoUpdates[poNumber][cleanSku] = (mpoUpdates[poNumber][cleanSku] || 0) + qty;
                }
            }

            for (const poNum of Object.keys(mpoUpdates)) {
                const poDoc = (mpoOrders || []).find(o => o.poNumber === parseInt(poNum, 10));
                if (poDoc) {
                    let allReceived = true;
                    const newItems = (poDoc.items || []).map(pit => {
                        const safeSku = (pit.sku || '').trim().toUpperCase();
                        const addQty = mpoUpdates[poNum][safeSku] || 0;
                        const newReceived = (pit.received || 0) + addQty;
                        if (newReceived < pit.qty) allReceived = false;
                        return { ...pit, received: newReceived };
                    });
                    batch.update(db.collection('purchase_orders').doc(poDoc.id), { items: newItems, status: allReceived ? 'ARRIVED' : poDoc.status });
                }
            }

            // TAMBAHKAN KE TRANSAKSI GLOBAL & ONLINE + UPDATE STATUS QC_ORDERS
            for (const [barcode, qty] of Object.entries(scannedItemsPenerima)) {
                const cleanSku = parseSku(barcode);
                const isOnline = barcode.includes('*');
                const txRef = db.collection('transactions').doc();

                if (isOnline) {
                    const finalBarcode = `${cleanSku}${new Date().toISOString().split('T')[0].replace(/-/g, '')}`;
                    batch.set(txRef, {
                        sku: cleanSku, qty: qty, type: 'ONLINE_IN',
                        fullBarcode: finalBarcode, date: new Date().toISOString(),
                        orderNo: activeDraft.id, note: `Cross-Docking QC via ${activeDraft.id}`,
                        user: activeReceiver.nama, batchId: activeDraft.id
                    });

                    // LOGIKA BARU: Sinkronisasi "Sisa Online" Dashboard
                    // Cari pesanan yang statusnya PENDING dengan barcode/sesi yang sama
                    const sessionNum = parseInt(barcode.split('*')[1], 10) || 1;
                    let remainingToFulfill = qty;

                    const targets = (qcOrders || []).filter(o =>
                        (o.status === 'PENDING' || o.status === 'TRANSIT') &&
                        (o.session || 1) === sessionNum &&
                        (o.items || []).some(it => (it.prodStatus || it.status) === 'PO' && (it.sysSku === cleanSku || it.sku === cleanSku))
                    ).sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));

                    for (const order of targets) {
                        if (remainingToFulfill <= 0) break;
                        let orderUpdated = false;
                        const newItems = order.items.map(it => {
                            if (remainingToFulfill > 0 && (it.prodStatus || it.status) === 'PO' && (it.sysSku === cleanSku || it.sku === cleanSku)) {
                                // Update status dari PO (Kurang) jadi READY agar hilang dari Sisa Online Dashbord 
                                // Gunakan prodStatus agar tidak terganggu proses QC ke depannya
                                remainingToFulfill -= it.qty; // Biasanya 1, tapi bisa lebih
                                orderUpdated = true;
                                return { ...it, status: 'READY', prodStatus: 'READY' };
                            }
                            return it;
                        });
                        if (orderUpdated) {
                            batch.update(db.collection('qc_orders').doc(order.id), { items: newItems });
                        }
                    }
                } else {
                    batch.set(txRef, {
                        sku: cleanSku, qty: qty, type: 'IN',
                        fullBarcode: barcode, date: new Date().toISOString(),
                        orderNo: activeDraft.id, note: `Surat Jalan (PO) via ${activeDraft.id}`,
                        user: activeReceiver.nama, batchId: activeDraft.id
                    });
                }
            }

            await batch.commit();
            setDraftConfirmed(true);
            beep(true);
            showToast('success', `SJ ${activeDraft.id} dikonfirmasi! Dashboard Sisa Online otomatis ter-update.`);
        } catch (err) {
            showToast('error', 'Gagal konfirmasi: ' + err.message);
        }
        setIsLoading(false);
    };

    // FUNGSI BARU: CETAK NOTA SURAT JALAN (Auto Split Kompak A6 - Fix Anti Amburadul 100%)
    const handleCetakSuratJalan = () => {
        if (!activeDraft) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            showToast('error', 'Pop-up diblokir! Izinkan browser membuka tab baru.');
            return;
        }

        const dateStr = new Date(activeDraft.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

        const poRows = [];
        const onlineRows = [];
        let totalPO = 0;
        let totalOnline = 0;
        let rowCounter = 1;

        (activeDraft.items || []).forEach((item) => {
            const qty = Number((activeDraft.status === 'ARRIVED' || activeDraft.status === 'SJ_CONFIRMED') ? (activeDraft.scanReceived?.[item.fullBarcode] || item.qty) : item.qty);
            if (qty <= 0) return;

            if (item.itemType === 'ONLINE') {
                onlineRows.push({ ...item, qty: qty });
                totalOnline += qty;
            } else {
                poRows.push({ ...item, qty: qty });
                totalPO += qty;
            }
        });

        // PERBAIKAN FINAL: Semua teks (Artikel, Varian, QTY) dikecilin jadi ukuran 10px dan font normal (tidak bold)
        const renderRows = (list) => {
            return list.map((item) => `
                        <tr style="border-bottom: 1px dashed #ccc;">
                            <td style="padding: 4px 4px; text-align: center; font-size: 10px;">${rowCounter++}</td>
                            <td style="padding: 4px 4px;">
                                <div style="display: flex; align-items: center;">
                                    <span style="width: 45%; text-align: left; font-size: 10px; font-weight: normal;">${item.article}</span> 
                                    <span style="width: 55%; text-align: center; color: #000; font-size: 10px; font-weight: normal;">${item.colorName} - ${item.sizeName}</span>
                                </div>
                            </td>
                            <td style="padding: 4px 4px; text-align: center; font-size: 10px; font-weight: normal;">${item.qty}</td>
                        </tr>
                    `).join('');
        };

        let finalTableBody = '';

        if (poRows.length > 0) {
            finalTableBody += `
                        <tr style="background-color: #f1f5f9;">
                            <td colspan="3" style="font-weight: bold; text-align: center; font-size: 10px; text-transform: uppercase; border: 1px dashed #000; padding: 3px;">>>> PO BENGKEL <<<</td>
                        </tr>
                        ${renderRows(poRows)}
                    `;
        }

        if (onlineRows.length > 0) {
            finalTableBody += `
                        <tr style="background-color: #ffe4e6;">
                            <td colspan="3" style="font-weight: bold; text-align: center; font-size: 10px; text-transform: uppercase; border: 1px dashed #000; padding: 3px;">>>> ONLINE <<<</td>
                        </tr>
                        ${renderRows(onlineRows)}
                    `;
        }

        const htmlContent = `
                    <!DOCTYPE html>
                    <html lang="id">
                    <head>
                        <meta charset="UTF-8">
                        <title>Surat Jalan - ${activeDraft.id}</title>
                        <style>
                            @page { size: A6 portrait; margin: 3mm; }
                            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #000; margin: 0; padding: 5px; }
                            
                            .super-compact-header { border: 1px solid #000; padding: 6px; margin-bottom: 8px; background-color: #f8fafc; }
                            .brand-section { display: flex; flex-direction: row; align-items: center; justify-content: center; border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 6px; }
                            .brand-section img { height: 32px; margin-right: 12px; }
                            .brand-text { display: flex; flex-direction: column; align-items: flex-start; }
                            .brand-text h2 { margin: 0 0 2px 0; font-size: 16px; font-weight: 900; letter-spacing: 1px; }
                            .brand-text .nota-title { margin: 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; }
                            
                            .info-row { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px; font-weight: normal; }
                            .info-row strong { font-weight: 900; }
                            
                            .single-table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 11px;}
                            .single-table th { border: 1px solid #000; padding: 6px 4px; text-align: left; font-size: 10px; text-transform: uppercase; background-color: #f1f5f9; font-weight: 900;}
                            
                            .total-box { text-align: left; font-size: 13px; font-weight: bold; padding: 8px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; margin-bottom: 20px; margin-top: 8px; }
                            
                            .signatures { display: flex; justify-content: space-between; text-align: center; }
                            .sign-box { width: 45%; }
                            .sign-title { font-size: 10px; font-weight: bold; margin-bottom: 45px; }
                            .sign-name { font-size: 11px; font-weight: bold; text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <div class="super-compact-header">
                            <div class="brand-section">
                                <img src="/duolaigudang/LogoV2.png" alt="Logo Faradela" />
                                <div class="brand-text">
                                    <h2>FARADELA OFFICIAL</h2>
                                    <p class="nota-title">TANDA TERIMA</p>
                                </div>
                            </div>
                            <div class="info-row">
                                 <div>SJ: <strong>${activeDraft.id}</strong></div>
                                 <div>Tgl: <strong>${dateStr}</strong></div>
                            </div>
                            <div class="info-row" style="margin-bottom: 0;">
                                 <div>Bkl: <strong>${activeDraft.workshop}</strong></div>
                                 <div>Oleh: <strong>${activeDraft.namaPengirim || '-'}</strong></div>
                            </div>
                        </div>

                        <table class="single-table">
                            <thead>
                                <tr>
                                    <th style="text-align: center; width: 8%;">No</th>
                                    <th style="text-align: center; width: 72%;">Nama Barang</th>
                                    <th style="text-align: center; width: 20%;">Qty</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${finalTableBody}
                            </tbody>
                        </table>

                        <div class="total-box">
                            <div style="font-size: 10px; font-weight: normal; margin-bottom: 3px;">Sub-Total PO: ${totalPO} Pcs</div>
                            <div style="font-size: 10px; font-weight: normal; margin-bottom: 6px;">Sub-Total Online: ${totalOnline} Pcs</div>
                            <div style="border-top: 1px dashed #000; padding-top: 4px;">GRAND TOTAL: ${totalPO + totalOnline} PCS</div>
                        </div>

                        <div class="signatures">
                            <div class="sign-box">
                                <div class="sign-title">Penerima Gudang,</div>
                                <div class="sign-name">( ........................................ )</div>
                            </div>
                            <div class="sign-box">
                                <div class="sign-title">Pengirim Bengkel,</div>
                                <div class="sign-name">${activeDraft.namaPengirim ? '( ' + activeDraft.namaPengirim + ' )' : '( ........................................ )'}</div>
                            </div>
                        </div>
                    </body>
                    </html>
                `;

        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();

        setTimeout(() => {
            printWindow.print();
        }, 500);
    };

    const handleUpdateStok = async () => {
        if (!activeDraft) return;
        const scanData = activeDraft.scanReceived || scannedItemsPenerima;
        if (Object.keys(scanData).length === 0) return showToast('error', 'Tidak ada data scan!');

        if (!confirm(`Update Rak Stok Fisik Gudang?\n\nHanya barang PO Pabrik yang akan masuk ke data detail stok. Barang Online dilewati karena sudah meluncur ke QC.`)) return;

        setIsLoading(true);
        try {
            const batchId = 'SJ' + activeDraft.id;
            const operatorName = activeReceiver.nama || 'Staff Gudang';

            for (const [barcode, qty] of Object.entries(scanData)) {
                if (qty > 0) {
                    const cleanSku = parseSku(barcode);
                    const isOnline = barcode.includes('*');

                    // JIKA ONLINE, LEWATI! (Karena Dashboard sudah di-update saat Konfirmasi)
                    if (isOnline) continue;

                    const txRef = db.collection('transactions').doc();
                    const finalBarcode = `${cleanSku}${new Date().toISOString().split('T')[0].replace(/-/g, '')}`;

                    batch.set(txRef, {
                        sku: cleanSku, qty: qty, type: 'IN',
                        fullBarcode: finalBarcode,
                        date: new Date().toISOString(),
                        orderNo: activeDraft.id,
                        batchId,
                        user: operatorName,
                        note: `SJ Digital: Masuk via ${activeDraft.id}`
                    });
                }
            }
            const sjRef = db.collection('surat_jalan').doc(activeDraft.id);
            batch.update(sjRef, { status: 'ARRIVED', arrivedAt: new Date().toISOString() });

            await batch.commit();
            beep(true);
            showToast('success', 'Rak fisik gudang berhasil ditambah dari pesanan PO!');
            setActiveDraft(null);
            setScannedItemsPenerima({});
            setDraftConfirmed(false);
        } catch (err) {
            showToast('error', 'Gagal update stok: ' + err.message);
        }
        setIsLoading(false);
    };

    const openDraft = (sj) => {
        setActiveDraft(sj);
        setScannedItemsPenerima(sj.scanReceived || {});
        setDraftConfirmed(sj.status === 'SJ_CONFIRMED' || sj.status === 'ARRIVED');
    };

    // FUNGSI BARU: Hapus Surat Jalan / Draft
    const handleDeleteSuratJalan = async (id) => {
        if (confirm('Yakin ingin menghapus Surat Jalan ini secara permanen?')) {
            setIsLoading(true);
            try {
                await db.collection('surat_jalan').doc(id).delete();
                showToast('success', 'Surat Jalan berhasil dihapus!');
            } catch (e) {
                showToast('error', 'Gagal menghapus: ' + e.message);
            }
            setIsLoading(false);
        }
    };

    const allDraftSJs = [
        // LOGIKA BARU: Tambahkan status 'ARRIVED' agar tidak hilang dari daftar setelah update stok
        ...suratJalanList.filter(s => s.status === 'SHIPPED' || s.status === 'SJ_CONFIRMED' || s.status === 'ARRIVED'),
        ...draftSJs.map(po => ({ ...po, isLegacyPO: true }))
    ];

    return (
        <div className="space-y-6">
            {/* Modal Scanner */}
            {showScanner && (
                <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
                    <div className="bg-white p-6 rounded-2xl w-full max-w-md shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-xl flex items-center gap-2">
                                <i className="fa-solid fa-camera text-orange-500"></i> {scannerLabel}
                            </h3>
                            <button type="button" onClick={() => setShowScanner(false)} className="bg-red-50 text-red-600 p-2 rounded-full">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>
                        <div id="reader-surat-jalan" className="w-full rounded-xl overflow-hidden border-2 border-slate-300"></div>
                    </div>
                </div>
            )}

            {/* Header Pilihan Bengkel */}
            <div className="bg-white p-6 md:p-8 rounded-3xl border shadow-sm">
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><i className="fa-solid fa-industry text-orange-500"></i> Produksi Bengkel</h2>
                <p className="text-slate-500 font-bold text-sm mt-1">Pilih Bengkel Pengirim atau Bagian Penerima Gudang.</p>

                <div className="flex gap-2 mt-5 border-b border-slate-100 overflow-x-auto custom-scrollbar">
                    {canLery && (
                        <button onClick={() => setActiveTab('lery')} className={`px-4 md:px-6 py-3 rounded-t-xl font-black text-sm transition-colors whitespace-nowrap ${activeTab === 'lery' ? 'bg-orange-500 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}><i className="fa-solid fa-industry mr-2"></i>Lery's Workshop (F01)</button>
                    )}
                    {canSamin && (
                        <button onClick={() => setActiveTab('samin')} className={`px-4 md:px-6 py-3 rounded-t-xl font-black text-sm transition-colors whitespace-nowrap ${activeTab === 'samin' ? 'bg-amber-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}><i className="fa-solid fa-scissors mr-2"></i>Pak Samin (F07)</button>
                    )}
                    {canFaradela && (
                        <button onClick={() => setActiveTab('faradela')} className={`px-4 md:px-6 py-3 rounded-t-xl font-black text-sm transition-colors whitespace-nowrap ${activeTab === 'faradela' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}><i className="fa-solid fa-building-circle-check mr-2"></i>Faradela Official</button>
                    )}
                </div>
            </div>

            {/* DASHBOARD TARGET HANYA TAMPIL DI BENGKEL (OPER PARAMETER TAB AGAR BISA DIFILTER) */}
            {(activeTab === 'lery' || activeTab === 'samin') && <DashboardProduksi currentUser={currentUser} mpoOrders={mpoOrders} qcOrders={qcOrders} variants={variants} transactions={transactions} activeTab={activeTab} showToast={showToast} setIsLoading={setIsLoading} />}

            {/* ============ TAB BENGKEL (PENGIRIM) ============ */}
            {(activeTab === 'lery' || activeTab === 'samin') && (
                !activeSender ? (
                    <div className="bg-white p-8 md:p-12 rounded-3xl border shadow-sm max-w-lg mx-auto text-center space-y-6">
                        <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center ${activeTab === 'lery' ? 'bg-orange-100 text-orange-500' : 'bg-amber-100 text-amber-500'}`}><i className="fa-solid fa-id-card text-5xl"></i></div>
                        <h3 className="text-2xl font-black text-slate-800">Scan ID Card {activeTab === 'lery' ? "Lery's Workshop" : 'Pak Samin'}</h3>
                        <p className="text-slate-500 font-bold text-sm">Scan barcode ID Card karyawan untuk memulai pengiriman.</p>
                        <form onSubmit={handleScanSenderId} className="flex gap-2">
                            <input ref={senderIdRef} type="text" placeholder="Scan ID Card..." value={senderIdInput} onChange={e => setSenderIdInput(e.target.value)} className={`flex-1 p-4 border-2 rounded-xl font-bold outline-none text-center text-lg ${activeTab === 'lery' ? 'border-orange-300 bg-orange-50 focus:border-orange-500' : 'border-amber-300 bg-amber-50 focus:border-amber-500'}`} autoFocus />
                            <button type="submit" className={`px-6 py-3 text-white rounded-xl font-black text-lg ${activeTab === 'lery' ? 'bg-orange-500' : 'bg-amber-600'}`}><i className="fa-solid fa-arrow-right"></i></button>
                        </form>
                        <button onClick={() => openScanner('senderId', `Scan ID Card ${activeTab === 'lery' ? 'Lery' : 'Samin'}`)} className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black transition-colors flex items-center justify-center gap-2">
                            <i className="fa-solid fa-camera text-xl"></i> Scan Pakai Kamera HP
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-5">
                            <div className="flex justify-between items-center border-b pb-4">
                                <h3 className="text-xl font-black text-slate-800"><i className={`fa-solid fa-clipboard-check mr-2 ${activeTab === 'lery' ? 'text-orange-500' : 'text-amber-500'}`}></i>Form Kirim {activeTab === 'lery' ? '(Lery)' : '(Samin)'}</h3>
                                <button onClick={() => { setActiveSender(null); setScannedItemsPengirim({}); setScannedTypePengirim({}); }} className="text-sm text-slate-500 hover:text-red-600 font-bold"><i className="fa-solid fa-right-from-bracket mr-1"></i>Ganti Pengirim</button>
                            </div>

                            <div className={`border-2 p-4 rounded-xl flex items-center gap-4 ${activeTab === 'lery' ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'}`}>
                                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl flex-shrink-0 ${activeTab === 'lery' ? 'bg-orange-500' : 'bg-amber-500'}`}><i className="fa-solid fa-user-check"></i></div>
                                <div>
                                    <div className="font-black text-slate-800 text-lg">{activeSender.nama}</div>
                                    <div className={`text-xs font-bold uppercase ${activeTab === 'lery' ? 'text-orange-600' : 'text-amber-600'}`}>{activeSender.posisi} &bull; ID: {activeSender.idKaryawan}</div>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Tanggal Kirim</label>
                                <input type="date" value={tglKirim} onChange={e => setTglKirim(e.target.value)} className="w-full p-4 border-2 border-slate-300 rounded-xl mt-1.5 font-bold bg-slate-50 outline-none focus:border-slate-500" />
                            </div>

                            <div>
                                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Scan Barcode Barang</label>
                                <form onSubmit={handleScanFormPengirim} className="flex gap-2 mt-1.5">
                                    <input ref={scanRefPengirim} type="text" placeholder={`Scan produk ${activeTab === 'lery' ? 'F01' : 'F07'}...`} value={scanInputPengirim} onChange={e => setScanInputPengirim(e.target.value)} className="flex-1 p-4 border-2 border-slate-300 rounded-xl font-bold bg-slate-50 outline-none focus:border-slate-500" autoFocus />
                                    <button type="submit" className={`px-5 py-3 text-white rounded-xl font-black ${activeTab === 'lery' ? 'bg-orange-500' : 'bg-amber-600'}`}><i className="fa-solid fa-qrcode"></i></button>
                                </form>
                                <button onClick={() => openScanner('itemsPengirim', 'Scan Barcode Barang')} className="mt-3 w-full py-4 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-black flex items-center justify-center gap-3 transition-transform transform active:scale-95 shadow-lg">
                                    <i className="fa-solid fa-camera text-2xl text-slate-300"></i>
                                    <div className="text-left">
                                        <div className="text-xs opacity-75 uppercase">Gunakan Kamera</div>
                                        <div className="text-sm">SCAN BARCODE HP</div>
                                    </div>
                                </button>
                            </div>
                            <button onClick={handleKirimSJ} disabled={Object.keys(scannedItemsPengirim).length === 0} className={`w-full text-white py-4 rounded-2xl font-black text-lg transition-colors shadow-lg disabled:bg-slate-200 disabled:text-slate-400 ${activeTab === 'lery' ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/30' : 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/30'}`}>
                                <i className="fa-solid fa-paper-plane mr-2"></i> KIRIM SURAT JALAN
                            </button>
                        </div>

                        <div className="bg-white p-8 rounded-3xl border shadow-sm flex flex-col">
                            <div className="flex justify-between items-center mb-6 border-b pb-4">
                                <h3 className="text-xl font-black text-slate-800"><i className={`fa-solid fa-boxes-stacked mr-2 ${activeTab === 'lery' ? 'text-orange-500' : 'text-amber-500'}`}></i>Barang Ter-scan</h3>
                                <span className={`text-white font-black px-4 py-1.5 rounded-xl text-sm ${activeTab === 'lery' ? 'bg-orange-500' : 'bg-amber-600'}`}>{Object.values(scannedItemsPengirim).reduce((a, b) => a + b, 0)} Pcs</span>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                                {Object.keys(scannedItemsPengirim).length > 0 ? Object.entries(scannedItemsPengirim).map(([barcode, qty]) => {
                                    const sku = parseSku(barcode);
                                    const variant = variants.find(v => v.sku === sku);
                                    const itemType = scannedTypePengirim[barcode] || 'UNKNOWN';
                                    return (
                                        <div key={barcode} className="p-4 rounded-xl border-2 border-slate-200 bg-white flex justify-between items-center">
                                            <div>
                                                <div className="font-black text-slate-800">{variant ? variant.article : sku} <span className={activeTab === 'lery' ? 'text-orange-500' : 'text-amber-600'}>{variant ? variant.sizeName : ''}</span></div>
                                                <div className="text-xs text-slate-500 font-bold">{variant ? variant.colorName : ''}</div>
                                                <span className={`inline-block mt-1 text-[10px] font-black uppercase px-2 py-0.5 rounded ${itemType === 'ONLINE' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    <i className={`fa-solid ${itemType === 'ONLINE' ? 'fa-cart-shopping' : 'fa-industry'} mr-1`}></i>{itemType === 'ONLINE' ? 'ONLINE ORDER' : 'PO PABRIK'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <button onClick={() => {
                                                    setScannedItemsPengirim(prev => {
                                                        const newQty = (prev[barcode] || 0) - 1;
                                                        const newState = { ...prev };
                                                        if (newQty <= 0) delete newState[barcode];
                                                        else newState[barcode] = newQty;
                                                        return newState;
                                                    });
                                                }} className="w-10 h-10 rounded-full bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors border border-rose-200 flex items-center justify-center shadow-sm" title="Batal Scan 1 Pcs">
                                                    <i className="fa-solid fa-minus"></i>
                                                </button>
                                                <div className="text-right">
                                                    <span className="font-black text-2xl text-slate-800">{qty}</span><span className="text-slate-400 font-bold ml-1">Pcs</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }) : <div className="text-center text-slate-400 font-bold py-16"><i className="fa-solid fa-barcode text-4xl block mb-3 opacity-30"></i>Scan barcode barang untuk memulai</div>}
                            </div>
                        </div>
                    </div>
                )
            )}

            {/* ============ TAB PENERIMA FARADELA ============ */}
            {activeTab === 'faradela' && (
                !activeReceiver ? (
                    <div className="bg-white p-8 md:p-12 rounded-3xl border shadow-sm max-w-lg mx-auto text-center space-y-6">
                        <div className="w-24 h-24 mx-auto bg-blue-100 rounded-full flex items-center justify-center"><i className="fa-solid fa-id-card text-blue-600 text-5xl"></i></div>
                        <h3 className="text-2xl font-black text-slate-800">Scan ID Card Penerima</h3>
                        <p className="text-slate-500 font-bold text-sm">Scan barcode ID Card karyawan untuk memulai penerimaan barang.</p>
                        <form onSubmit={handleScanReceiverId} className="flex gap-2">
                            <input ref={receiverIdRef} type="text" placeholder="Scan ID Card..." value={receiverIdInput} onChange={e => setReceiverIdInput(e.target.value)} className="flex-1 p-4 border-2 border-blue-300 rounded-xl font-bold bg-blue-50 outline-none focus:border-blue-500 text-center text-lg" autoFocus />
                            <button type="submit" className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-lg"><i className="fa-solid fa-arrow-right"></i></button>
                        </form>
                        <button onClick={() => openScanner('receiverId', 'Scan ID Card Penerima')} className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black transition-colors flex items-center justify-center gap-2">
                            <i className="fa-solid fa-camera text-xl"></i> Scan Pakai Kamera HP
                        </button>
                    </div>
                ) : activeDraft ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-5">
                            <div className="flex justify-between items-center border-b pb-4">
                                <h3 className="text-xl font-black text-slate-800"><i className="fa-solid fa-barcode text-blue-600 mr-2"></i>Verifikasi: {activeDraft.id}</h3>
                                <button onClick={() => { setActiveDraft(null); setScannedItemsPenerima({}); setDraftConfirmed(false); }} className="text-sm text-slate-500 hover:text-slate-800 font-bold"><i className="fa-solid fa-arrow-left mr-1"></i>Kembali</button>
                            </div>
                            <div className="bg-blue-50 border-2 border-blue-200 p-4 rounded-xl flex items-center gap-4">
                                <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white text-xl flex-shrink-0"><i className="fa-solid fa-user-check"></i></div>
                                <div>
                                    <div className="font-black text-slate-800">{activeReceiver.nama} <span className="text-xs text-blue-600">({activeReceiver.posisi})</span></div>
                                    <div className="text-xs font-bold text-slate-500">Pengirim: <b>{activeDraft.workshop || 'Bengkel'}</b> &bull; Tgl: {activeDraft.tglKirim || '-'}</div>
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Scan Barcode</label>
                                <form onSubmit={handleScanFormPenerima} className="flex gap-2 mt-1.5">
                                    <input ref={scanRefPenerima} type="text" placeholder="Scan atau ketik barcode..." value={scanInputPenerima} onChange={e => setScanInputPenerima(e.target.value)} className="flex-1 p-4 border-2 border-slate-300 rounded-xl font-bold bg-slate-50 outline-none focus:border-blue-500" autoFocus />
                                    <button type="submit" className="px-5 py-3 bg-blue-600 text-white rounded-xl font-black"><i className="fa-solid fa-qrcode"></i></button>
                                </form>
                                <button onClick={() => openScanner('itemsPenerima', 'Scan Barcode Barang')} className="mt-3 w-full py-4 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-black flex items-center justify-center gap-3 transition-transform transform active:scale-95 shadow-lg">
                                    <i className="fa-solid fa-camera text-2xl text-orange-400"></i>
                                    <div className="text-left">
                                        <div className="text-xs opacity-75 uppercase">Gunakan Kamera</div>
                                        <div className="text-sm">SCAN BARCODE HP</div>
                                    </div>
                                </button>
                            </div>
                            <div className="space-y-3">
                                <button onClick={handleKonfirmasi}
                                    disabled={draftConfirmed || !activeDraft?.items.every(item => (scannedItemsPenerima[item.fullBarcode] || 0) >= item.qty)}
                                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none text-white py-4 rounded-2xl font-black transition-colors shadow-lg">
                                    <i className="fa-solid fa-clipboard-check mr-2"></i> KONFIRMASI PENERIMAAN
                                    {draftConfirmed && <span className="ml-2 text-xs">(Dikonfirmasi)</span>}
                                    {!draftConfirmed && !activeDraft?.items.every(item => (scannedItemsPenerima[item.fullBarcode] || 0) >= item.qty) && <span className="ml-2 text-xs font-bold text-slate-500">(Belum Lengkap)</span>}
                                </button>
                                <button
                                    onClick={handleUpdateStok}
                                    disabled={activeDraft?.status === 'ARRIVED'}
                                    className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none text-white py-4 rounded-2xl font-black transition-colors shadow-lg mt-4"
                                >
                                    <i className={`fa-solid ${activeDraft?.status === 'ARRIVED' ? 'fa-check-double' : 'fa-boxes-packing'} mr-2`}></i>
                                    {activeDraft?.status === 'ARRIVED' ? 'STOK SUDAH MASUK GUDANG' : 'UPDATE STOK GUDANG'}
                                </button>

                                {/* TOMBOL BARU: CETAK SURAT JALAN (GANTI WARNA ORANGE) */}
                                <button onClick={handleCetakSuratJalan} className="w-full bg-orange-500 hover:bg-orange-600 text-white py-4 rounded-2xl font-black transition-colors shadow-lg mt-4 border-2 border-orange-600/50">
                                    <i className="fa-solid fa-print mr-2"></i> CETAK NOTA TANDA TERIMA
                                </button>
                            </div>
                        </div>

                        <div className="bg-white p-8 rounded-3xl border shadow-sm flex flex-col">
                            <div className="flex justify-between items-center mb-6 border-b pb-4">
                                <h3 className="text-xl font-black text-slate-800"><i className="fa-solid fa-list-check text-blue-600 mr-2"></i>Cek Barang</h3>
                                <span className="bg-blue-600 text-white font-black px-4 py-1.5 rounded-xl text-sm">{Object.values(scannedItemsPenerima).reduce((a, b) => a + b, 0)} Pcs</span>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                                {activeDraft.items.map(item => {
                                    const expected = item.qty;
                                    const scanned = scannedItemsPenerima[item.fullBarcode] || 0;
                                    const full = scanned >= expected;
                                    return (
                                        <div key={item.fullBarcode} className={`p-4 rounded-xl border-2 flex justify-between items-center ${full ? 'border-teal-400 bg-teal-50' : 'border-slate-200'}`}>
                                            <div>
                                                <div className="font-black text-slate-800">{item.article} <span className="text-blue-500">{item.sizeName}</span></div>
                                                <div className="text-xs text-slate-500 font-bold">{item.colorName}</div>
                                                {item.itemType && <span className={`inline-block mt-1 text-[10px] font-black uppercase px-2 py-0.5 rounded ${item.itemType === 'ONLINE' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{item.itemType === 'ONLINE' ? 'ONLINE' : 'PO'}</span>}
                                            </div>
                                            <div className="flex items-center gap-4">
                                                {scanned > 0 && !draftConfirmed && (
                                                    <button onClick={() => setScannedItemsPenerima(prev => ({ ...prev, [item.fullBarcode]: prev[item.fullBarcode] - 1 }))} className="w-10 h-10 rounded-full bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors border border-rose-200 flex items-center justify-center shadow-sm" title="Batal Scan 1 Pcs">
                                                        <i className="fa-solid fa-minus"></i>
                                                    </button>
                                                )}
                                                <div className="text-right">
                                                    <span className={`font-black text-2xl ${full ? 'text-teal-600' : 'text-slate-800'}`}>{scanned}</span><span className="text-slate-400 font-bold">/{expected}</span>
                                                    {full && <div><i className="fa-solid fa-check-circle text-teal-500 text-sm"></i></div>}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div>
                        <div className="bg-blue-50 border-2 border-blue-200 p-4 rounded-xl mb-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white"><i className="fa-solid fa-user-check"></i></div>
                                <div><span className="font-black text-slate-800">{activeReceiver.nama}</span> <span className="text-xs text-blue-600 font-bold">({activeReceiver.posisi})</span></div>
                            </div>
                            <button onClick={() => setActiveReceiver(null)} className="text-sm text-slate-500 hover:text-red-600 font-bold"><i className="fa-solid fa-right-from-bracket mr-1"></i>Ganti Penerima</button>
                        </div>
                        <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
                            {allDraftSJs.length === 0 && (
                                <div className="text-center p-10 bg-white rounded-3xl border shadow-sm text-slate-400">
                                    <i className="fa-regular fa-folder-open text-5xl mb-3 block"></i>
                                    <h3 className="text-base font-bold">Belum Ada Surat Jalan Masuk</h3>
                                    <p className="text-xs mt-1">Minta tim Bengkel mengirim barang via tab Lery/Samin.</p>
                                </div>
                            )}
                            {allDraftSJs.map(sj => {
                                const totalPcs = sj.totalPcs || (sj.items || []).reduce((a, c) => a + (c.shipped || c.qty), 0);
                                const isConfirmed = sj.status === 'SJ_CONFIRMED' || sj.status === 'ARRIVED';
                                return (
                                    <div key={sj.id} className="bg-white border-2 hover:border-blue-300 p-4 rounded-2xl shadow-sm transition flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                        <div className="flex-1 cursor-pointer" onClick={() => openDraft(sj)}>
                                            <div className="flex items-center gap-3 mb-1">
                                                <div className="font-black text-lg text-slate-800">{sj.id}</div>
                                                <span className={`font-black px-2 py-0.5 rounded text-[10px] uppercase ${isConfirmed ? 'bg-teal-100 text-teal-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    {isConfirmed ? 'SELESAI' : 'MENUNGGU'}
                                                </span>
                                            </div>
                                            <div className="text-xs font-bold text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                                                <span><i className="fa-solid fa-industry mr-1"></i>{sj.workshop || 'Bengkel'}</span>
                                                <span><i className="fa-solid fa-user mr-1"></i>{sj.namaPengirim || '-'}</span>
                                                <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded"><i className="fa-solid fa-box mr-1"></i>{totalPcs} Pcs</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-end gap-2 w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
                                            <button onClick={() => openDraft(sj)} className="flex-1 sm:flex-none bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white px-5 py-2.5 rounded-xl font-black text-sm transition-colors">
                                                BUKA
                                            </button>
                                            <button onClick={() => handleDeleteSuratJalan(sj.id)} className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white flex items-center justify-center transition-colors shadow-sm" title="Hapus Surat Jalan">
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )
            )}
        </div>
    );
}


// ==========================================
// FITUR: KAS OPERASIONAL (VERSI KAMERA IN-APP + ANTI LOADING)
// ==========================================
function KasOperasional({ showToast }) {
    const [tanggal, setTanggal] = React.useState(new Date().toISOString().split('T'));
    const [dataKas, setDataKas] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [form, setForm] = React.useState({ jenis: 'keluar', nominal: '', keterangan: '' });

    // State Kamera & Foto
    const [fotoPreview, setFotoPreview] = React.useState(null);
    const [isCameraOpen, setIsCameraOpen] = React.useState(false);
    const [facingMode, setFacingMode] = React.useState('environment');

    const videoRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const streamRef = React.useRef(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const snapshot = await db.collection('kas_operasional').orderBy('timestamp', 'asc').get();
            const allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setDataKas(allData);
        } catch (error) {
            console.error("Gagal load kas:", error);
        }
        setLoading(false);
    };

    React.useEffect(() => {
        loadData();
        return () => stopCamera();
    }, []);

    // -------- LOGIKA KAMERA --------
    const startCamera = async (mode = 'environment') => {
        setIsCameraOpen(true);
        try {
            if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (error) {
            showToast('error', 'Gagal mengakses kamera. Izinkan akses kamera.');
            setIsCameraOpen(false);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setIsCameraOpen(false);
    };

    const switchCamera = () => {
        const newMode = facingMode === 'environment' ? 'user' : 'environment';
        setFacingMode(newMode);
        startCamera(newMode);
    };

    const jepretFoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;

            // PERBAIKAN: Kompres ukuran foto agar aman masuk database langsung
            const MAX_WIDTH = 800;
            const scale = MAX_WIDTH / video.videoWidth;
            canvas.width = MAX_WIDTH;
            canvas.height = video.videoHeight * scale;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Ubah jadi Base64 kualitas 60% agar ringan (sekitar 50-100kb)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            setFotoPreview(dataUrl);

            stopCamera();
        }
    };
    // ---------------------------------------

    const saldoAwal = dataKas
        .filter(d => d.tanggal < tanggal)
        .reduce((sum, d) => d.jenis === 'masuk' ? sum + d.nominal : sum - d.nominal, 0);

    const dataHariIni = dataKas.filter(d => d.tanggal === tanggal);
    const totalMasukHariIni = dataHariIni.filter(d => d.jenis === 'masuk').reduce((sum, d) => sum + d.nominal, 0);
    const totalKeluarHariIni = dataHariIni.filter(d => d.jenis === 'keluar').reduce((sum, d) => sum + d.nominal, 0);
    const sisaSaldo = saldoAwal + totalMasukHariIni - totalKeluarHariIni;

    const handleSimpan = async (e) => {
        e.preventDefault();
        if (!form.nominal || !form.keterangan) return showToast('error', 'Lengkapi data!');
        setLoading(true);
        try {
            // LANGSUNG SIMPAN KE DATABASE (TIDAK PAKAI STORAGE LAGI)
            await db.collection('kas_operasional').add({
                tanggal: tanggal,
                jenis: form.jenis,
                nominal: Number(form.nominal),
                keterangan: form.keterangan,
                buktiUrl: fotoPreview, // Masukkan foto Base64 langsung
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            setForm({ jenis: 'keluar', nominal: '', keterangan: '' });
            setFotoPreview(null); // Kosongkan preview foto

            showToast('success', 'Transaksi berhasil dicatat!');
            loadData();
        } catch (error) {
            console.error(error);
            showToast('error', "Gagal menyimpan! Cek koneksi Anda.");
        }
        setLoading(false);
    };

    const hapusTransaksi = async (item) => {
        if (confirm('Yakin ingin menghapus transaksi ini?')) {
            try {
                // Cukup hapus dari database saja
                await db.collection('kas_operasional').doc(item.id).delete();
                showToast('success', 'Transaksi dihapus!');
                loadData();
            } catch (error) {
                showToast('error', 'Gagal menghapus sepenuhnya.');
            }
        }
    };

    const copyToWA = () => {
        const dateObj = new Date(tanggal);
        const formatTgl = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

        let teksWA = `LAPORAN SALDO HARIAN ${formatTgl}\n\n`;
        const saldoPagi = saldoAwal + totalMasukHariIni;
        teksWA += `SALDO : ${saldoPagi.toLocaleString('id-ID')}\n\n`;

        const keluarHariIni = dataHariIni.filter(d => d.jenis === 'keluar');
        keluarHariIni.forEach(item => {
            teksWA += `${item.keterangan}  : ${item.nominal.toLocaleString('id-ID')}\n`;
        });

        teksWA += `\n___________+\n`;
        teksWA += `TOTAL                 ${totalKeluarHariIni.toLocaleString('id-ID')}\n\n`;
        teksWA += `SISA SALDO    ${sisaSaldo.toLocaleString('id-ID')}`;

        navigator.clipboard.writeText(teksWA);
        showToast('success', "Laporan disalin! Silakan Paste di WA.");
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in zoom-in duration-300">
            {/* Header & Papan Saldo */}
            <div className="bg-white p-6 rounded-3xl border shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><i className="fa-solid fa-wallet text-orange-500"></i> Kas Operasional</h2>
                </div>
                <button onClick={copyToWA} className="w-full md:w-auto bg-emerald-500 text-white px-6 py-3.5 rounded-xl font-black text-sm hover:bg-emerald-600 transition-transform transform hover:-translate-y-1 shadow-lg shadow-emerald-500/30">
                    <i className="fa-brands fa-whatsapp text-xl mr-2"></i> COPY FORMAT WA
                </button>
            </div>

            <div className={`p-8 rounded-3xl shadow-xl text-white font-bold relative overflow-hidden ${sisaSaldo < 0 ? 'bg-red-500' : 'bg-slate-900'}`}>
                <i className="fa-solid fa-coins absolute -right-4 -bottom-4 text-8xl opacity-20"></i>
                <p className="text-sm opacity-90 uppercase tracking-widest mb-1 text-orange-400">Sisa Saldo Saat Ini</p>
                <h3 className="text-5xl font-black">Rp {sisaSaldo.toLocaleString('id-ID')}</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Form Input */}
                <div className="bg-white p-6 rounded-3xl border shadow-sm h-fit">
                    <h4 className="font-black mb-5 text-slate-800 border-b pb-3"><i className="fa-solid fa-pen-to-square mr-2 text-orange-500"></i> Catat Transaksi</h4>
                    <form onSubmit={handleSimpan} className="space-y-4">
                        <div>
                            <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Tanggal</label>
                            <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className="w-full p-4 border-2 rounded-xl bg-slate-50 font-bold outline-none focus:border-orange-500 mt-1" />
                        </div>
                        <div className="flex gap-4">
                            <label className={`flex-1 p-4 border-2 rounded-xl cursor-pointer font-black text-center transition-colors ${form.jenis === 'keluar' ? 'bg-red-50 border-red-500 text-red-600 shadow-sm' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}>
                                <input type="radio" name="jenis" className="hidden" checked={form.jenis === 'keluar'} onChange={() => setForm({ ...form, jenis: 'keluar' })} />
                                <i className="fa-solid fa-arrow-trend-down mr-2"></i> Keluar
                            </label>
                            <label className={`flex-1 p-4 border-2 rounded-xl cursor-pointer font-black text-center transition-colors ${form.jenis === 'masuk' ? 'bg-emerald-50 border-emerald-500 text-emerald-600 shadow-sm' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}>
                                <input type="radio" name="jenis" className="hidden" checked={form.jenis === 'masuk'} onChange={() => setForm({ ...form, jenis: 'masuk' })} />
                                <i className="fa-solid fa-arrow-trend-up mr-2"></i> Masuk
                            </label>
                        </div>
                        <div>
                            <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Nominal (Rp)</label>
                            <input type="number" value={form.nominal} onChange={(e) => setForm({ ...form, nominal: e.target.value })} className="w-full p-4 border-2 rounded-xl bg-slate-50 font-bold outline-none focus:border-orange-500 mt-1" required />
                        </div>
                        <div>
                            <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Keterangan</label>
                            <input type="text" value={form.keterangan} onChange={(e) => setForm({ ...form, keterangan: e.target.value })} className="w-full p-4 border-2 rounded-xl bg-slate-50 font-bold outline-none focus:border-orange-500 mt-1" required />
                        </div>

                        {/* TOMBOL BUKA KAMERA ATAU PREVIEW FOTO */}
                        <div className="bg-slate-50 p-4 rounded-xl border-2 border-slate-100 mt-2">
                            <label className="text-xs font-black text-slate-500 uppercase tracking-wider block mb-2"><i className="fa-solid fa-camera mr-2 text-orange-500"></i> Foto Nota (Opsional)</label>

                            {!fotoPreview ? (
                                <button type="button" onClick={() => startCamera('environment')} className="w-full border-2 border-dashed border-orange-300 bg-orange-50 text-orange-600 font-bold py-4 rounded-xl hover:bg-orange-100 transition-colors flex items-center justify-center gap-2">
                                    <i className="fa-solid fa-camera text-xl"></i> BUKA KAMERA NOTA
                                </button>
                            ) : (
                                <div className="relative group rounded-xl overflow-hidden border-2 border-orange-200">
                                    <img src={fotoPreview} alt="Preview Nota" className="w-full h-48 object-cover" />
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button type="button" onClick={() => setFotoPreview(null)} className="bg-rose-500 text-white px-4 py-2 rounded-lg font-bold">
                                            <i className="fa-solid fa-trash-can mr-2"></i> HAPUS FOTO
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button type="submit" disabled={loading} className="w-full bg-orange-500 text-white font-black py-4 rounded-xl hover:bg-orange-600 transition-transform transform hover:-translate-y-1 shadow-lg mt-2 relative overflow-hidden">
                            {loading ? <i className="fa-solid fa-circle-notch fa-spin mr-2"></i> : <><i className="fa-solid fa-save mr-2"></i> SIMPAN TRANSAKSI</>}
                        </button>
                    </form>
                </div>

                {/* Riwayat */}
                <div className="bg-white p-6 rounded-3xl border shadow-sm flex flex-col h-[650px]">
                    <h4 className="font-black mb-5 text-slate-800 border-b pb-3"><i className="fa-solid fa-list-check mr-2 text-orange-500"></i> Riwayat Tanggal: <span className="text-orange-500">{tanggal}</span></h4>
                    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                        {dataHariIni.map((item) => (
                            <div key={item.id} className="flex justify-between items-center bg-slate-50 border-2 border-slate-100 p-4 rounded-2xl">
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white ${item.jenis === 'masuk' ? 'bg-emerald-500' : 'bg-red-500'}`}>
                                        <i className={`fa-solid ${item.jenis === 'masuk' ? 'fa-plus' : 'fa-minus'}`}></i>
                                    </div>
                                    <div>
                                        <p className="font-black text-slate-800 text-base">{item.keterangan}</p>
                                        <div className="flex items-center gap-3">
                                            <p className={`text-sm font-bold ${item.jenis === 'masuk' ? 'text-emerald-600' : 'text-red-600'}`}>
                                                Rp {item.nominal.toLocaleString('id-ID')}
                                            </p>
                                            {item.buktiUrl && (
                                                <a href={item.buktiUrl} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center hover:bg-orange-500 hover:text-white transition-colors">
                                                    <i className="fa-solid fa-camera text-sm"></i>
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <button onClick={() => hapusTransaksi(item)} className="text-rose-400 hover:text-rose-600"><i className="fa-solid fa-trash-can"></i></button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* MODAL KAMERA FULL SCREEN */}
            {isCameraOpen && (
                <div className="fixed inset-0 z- bg-black flex flex-col animate-in fade-in duration-200">
                    <div className="p-4 flex justify-between items-center absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 to-transparent">
                        <button onClick={stopCamera} className="bg-rose-500/90 text-white px-5 py-3 rounded-2xl font-black text-xs md:text-sm flex items-center gap-2 hover:bg-rose-600 backdrop-blur-sm">
                            <i className="fa-solid fa-xmark text-lg"></i> TUTUP KAMERA
                        </button>
                        <button onClick={switchCamera} className="bg-slate-700/90 text-white px-5 py-3 rounded-2xl font-black text-xs md:text-sm flex items-center gap-2 hover:bg-slate-600 backdrop-blur-sm">
                            <i className="fa-solid fa-rotate text-lg"></i> GANTI KAMERA
                        </button>
                    </div>

                    <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden mt-16 md:mt-0">
                        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-64 h-64 border-2 border-white/30 rounded-3xl relative">
                                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-orange-500 rounded-tl-xl"></div>
                                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-orange-500 rounded-tr-xl"></div>
                                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-orange-500 rounded-bl-xl"></div>
                                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-orange-500 rounded-br-xl"></div>
                            </div>
                        </div>
                    </div>

                    <div className="p-8 pb-12 bg-black flex justify-center items-center">
                        <button onClick={jepretFoto} className="w-20 h-20 bg-orange-500 rounded-full border-4 border-white shadow-[0_0_20px_rgba(249,115,22,0.6)] flex items-center justify-center hover:scale-95 transition-transform active:bg-orange-600">
                            <i className="fa-solid fa-camera text-3xl text-white"></i>
                        </button>
                    </div>

                    <canvas ref={canvasRef} className="hidden" />
                </div>
            )}
        </div>
    );
}
// ==========================================
// AKHIR FITUR KAS OPERASIONAL
// ==========================================
function LoginPage({ onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        const emailFormat = username.toLowerCase() + '@faradela.id';

        try {
            // Animasi selama 2 detik sebelum cek ke database
            await new Promise(resolve => setTimeout(resolve, 2000));

            // TAHAP 1: Coba Autentikasi (Login)
            try {
                await firebase.auth().signInWithEmailAndPassword(emailFormat, password);
            } catch (authError) {
                // Jika akun belum ada, otomatis buatkan (Khusus Admin)
                if (authError.code === 'auth/user-not-found' || authError.code === 'auth/invalid-login-credentials' || authError.code === 'auth/invalid-credential') {
                    if (username === 'mindela' && password === 'Sukses@2026') {
                        await firebase.auth().createUserWithEmailAndPassword(emailFormat, password);

                        // PERBAIKAN FINAL: Gunakan variabel 'db' langsung bawaan aplikasi Anda!
                        await db.collection('users').doc('mindela').set({ username: 'mindela', password: 'Sukses@2026', role: 'admin', access: [] });

                        alert('✅ Akun Berhasil Terdaftar! Silakan klik MASUK SEKARANG sekali lagi.');
                        setLoading(false);
                        return; // Berhenti di sini agar user klik masuk lagi
                    } else {
                        throw new Error("Username atau Password salah!");
                    }
                } else if (authError.code === 'auth/email-already-in-use') {
                    throw new Error("Akun nyangkut! Hapus mindela@faradela.id di tab Authentication Firebase.");
                } else {
                    throw authError; // Lempar error lain
                }
            }

            // TAHAP 2: Jika login sukses, tarik data dari database
            // PERBAIKAN FINAL: Gunakan variabel 'db' langsung!
            const snap = await db.collection('users').where('username', '==', username.toLowerCase()).get();
            if (!snap.empty) {
                onLogin({ id: snap.docs[0].id, ...snap.docs[0].data() });
            } else {
                alert('Akses Ditolak! Akun terdaftar tapi data tidak ada di tabel users.');
                await firebase.auth().signOut();
            }

        } catch (error) {
            alert('GAGAL: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 flex items-center justify-center pointer-events-none"><i className="fa-solid fa-cubes text-[30rem] text-orange-500"></i></div>
            <div className={`w-full max-w-md rounded-3xl relative z-10 transition-all duration-500 min-h-[480px] flex flex-col justify-center ${!loading ? 'bg-white p-10 shadow-2xl' : ''}`}>
                {!loading ? (
                    <>
                        <div className="text-center mb-10"><div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 overflow-hidden p-2 bg-slate-50 shadow-inner border-2 border-transparent"><img src="/duolaigudang/LogoV2.png" alt="Logo" className="w-full h-full object-contain" /></div><h2 className="text-3xl font-black text-slate-800">Faradela Management</h2><p className="text-sm font-bold text-slate-400 mt-1 tracking-widest">(Versi 2.0 by Ahmad)</p></div>
                        <form onSubmit={handleLogin} action="javascript:void(0);" className="space-y-6">
                            <div><label className="block text-sm font-black text-slate-700 mb-2 ml-1">USERNAME</label><input required value={username} onChange={e => setUsername(e.target.value)} className="w-full p-4 border-2 border-slate-200 rounded-2xl bg-slate-50 focus:bg-white focus:border-orange-500 outline-none transition-colors font-bold text-slate-800 text-lg shadow-inner" placeholder="Ketik ID..." /></div>
                            <div><label className="block text-sm font-black text-slate-700 mb-2 ml-1">PASSWORD</label><input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 border-2 border-slate-200 rounded-2xl bg-slate-50 focus:bg-white focus:border-orange-500 outline-none transition-colors font-bold text-slate-800 text-lg shadow-inner" placeholder="Ketik Katasandi..." /></div>
                            <button className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-lg hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/40 mt-4">MASUK SEKARANG</button>
                        </form>
                    </>
                ) : (
                    <div className="flex items-center justify-center pointer-events-none scale-110">
                        <img src="/duolaigudang/LogoV2.png" alt="Logo" className="w-72 h-72 sm:w-80 sm:h-80 object-contain animate-logo-flip" />
                    </div>
                )}
            </div>
        </div>
    );
}


export default App;

