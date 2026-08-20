const fs = require('fs');
let code = fs.readFileSync('d:/Ahmad/Project webapk/Web Syaren Official/syaren management gudang/src/App.jsx', 'utf8');

const scannerComponent = `
// ==========================================
// ZxingScanner Component
// ==========================================
const ZxingScanner = ({ onScan, videoId = 'video-reader' }) => {
    const lastScanRef = React.useRef({ text: '', time: 0 });
    
    React.useEffect(() => {
        let codeReader = null;
        let isMounted = true;
        
        const initScanner = async () => {
            if (!window.ZXing || !isMounted) return;
            codeReader = new window.ZXing.BrowserMultiFormatReader();
            try {
                const constraints = { video: { facingMode: 'environment' } };
                await codeReader.decodeFromConstraints(constraints, videoId, (result, err) => {
                    if (result && isMounted) {
                        const text = result.getText();
                        const now = Date.now();
                        if (lastScanRef.current.text === text && now - lastScanRef.current.time < 2000) return;
                        
                        lastScanRef.current = { text, time: now };
                        onScan(text);
                    }
                });
            } catch(e) {
                console.error('Scanner Error:', e);
            }
        };

        if (!window.ZXing) {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@zxing/library@latest/umd/index.min.js';
            script.onload = initScanner;
            document.head.appendChild(script);
        } else {
            initScanner();
        }

        return () => {
            isMounted = false;
            if (codeReader) codeReader.reset();
        };
    }, [onScan, videoId]);

    return (
        <div className="w-full bg-slate-900 rounded-xl overflow-hidden border-2 border-slate-300 relative aspect-video flex items-center justify-center shadow-inner">
            <video id={videoId} className="w-full h-full object-cover"></video>
            <div className="absolute inset-0 pointer-events-none border-2 border-green-500/50 m-6 rounded-lg shadow-[0_0_0_4000px_rgba(0,0,0,0.5)] z-10 flex items-center justify-center">
                 <div className="w-full h-0.5 bg-green-500/50 animate-pulse shadow-[0_0_10px_#22c55e]"></div>
            </div>
            <div className="absolute top-2 left-2 bg-black/70 text-white px-2 py-1 rounded-md text-xs font-bold z-20 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Kamera Aktif (Zxing)
            </div>
        </div>
    );
};
`;

code = code.replace('// ==========================================\nconst firebaseConfig', scannerComponent + '\n// ==========================================\nconst firebaseConfig');

fs.writeFileSync('d:/Ahmad/Project webapk/Web Syaren Official/syaren management gudang/src/App.jsx', code);
console.log('Injected ZxingScanner component');
