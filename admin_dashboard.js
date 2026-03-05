// Firebase Imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, collection, addDoc, serverTimestamp, onSnapshot, query } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// App ID Configuration
const appId = typeof __app_id !== 'undefined' ? __app_id : 'my-portfolio-analytics';

// Global Firebase Instances
let app, auth, db, unsubscribeSnapshot = null;

// DOM Elements Cache
const DOM = {
    navbar: document.getElementById('navbar'),
    reveals: document.querySelectorAll('.reveal'),
    globe: document.getElementById('globe'),
    globeContainer: document.getElementById('globe-container'),
    logos: document.querySelectorAll('.logo'),
    passcodeModal: document.getElementById('passcodeModal'),
    passcodeInput: document.getElementById('passcodeInput'),
    passcodeError: document.getElementById('passcodeError'),
    submitPasscodeBtn: document.getElementById('submitPasscodeBtn'),
    cancelPasscodeBtn: document.getElementById('cancelPasscodeBtn'),
    closePasscodeOverlay: document.getElementById('closePasscodeOverlay'),
    adminModal: document.getElementById('adminModal'),
    closeAdminBtn: document.getElementById('closeAdminBtn'),
    closeAdminOverlay: document.getElementById('closeAdminOverlay'),
    visitLogBody: document.getElementById('visitLogBody'),
    statTotalViews: document.getElementById('statTotalViews'),
    statUniqueUsers: document.getElementById('statUniqueUsers'),
    statDeviceSplit: document.getElementById('statDeviceSplit')
};

// ==========================================
// 1. UI Interaction Logic
// ==========================================
function initUI() {
    // Scroll Reveal Animation
    if (DOM.reveals.length) {
        const observerOptions = { root: null, rootMargin: '0px', threshold: 0.1 };
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) entry.target.classList.add('active');
            });
        }, observerOptions);
        DOM.reveals.forEach(el => observer.observe(el));
    }

    // Navbar Scroll Effect
    if (DOM.navbar) {
        window.addEventListener('scroll', () => {
            DOM.navbar.classList.toggle('scrolled', window.scrollY > 20);
        });
    }

    // Globe Animation
    if (DOM.globe && DOM.globeContainer) {
        let currentAngle = 0;
        let speed = 0.25;
        const targetSpeed = 0.25;
        let isHovered = false;
        let hasSpun = false;

        DOM.globe.addEventListener('mouseenter', () => isHovered = true);
        DOM.globe.addEventListener('mouseleave', () => isHovered = false);

        const animateGlobe = () => {
            if (!isHovered) {
                speed = speed + (targetSpeed - speed) * 0.03;
                currentAngle += speed;
                DOM.globe.style.transform = `rotateX(-5deg) rotateY(${currentAngle}deg)`;
            }
            requestAnimationFrame(animateGlobe);
        };
        animateGlobe();

        const globeObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !hasSpun) {
                    speed = 35;
                    hasSpun = true;
                }
            });
        }, { threshold: 0.2 });
        globeObserver.observe(DOM.globeContainer);
    }
}

// ==========================================
// 2. Admin Modal Triggers & Logic
// ==========================================
function initAdminTriggers() {
    let clickCount = 0;
    let clickTimer;

    const triggerAdminPrompt = () => {
        if (!DOM.passcodeInput || !DOM.passcodeModal) return;
        DOM.passcodeInput.value = '';
        DOM.passcodeError.style.display = 'none';
        DOM.passcodeModal.classList.add('show');
        setTimeout(() => DOM.passcodeInput.focus(), 100);
        clickCount = 0;
    };

    DOM.logos.forEach(logo => {
        logo.addEventListener('click', (e) => {
            e.preventDefault();
            clickCount++;
            clearTimeout(clickTimer);
            if (clickCount >= 5) {
                triggerAdminPrompt();
            } else {
                clickTimer = setTimeout(() => { clickCount = 0; }, 1500);
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            triggerAdminPrompt();
        }
    });

    const closePasscode = () => DOM.passcodeModal?.classList.remove('show');
    
    DOM.cancelPasscodeBtn?.addEventListener('click', closePasscode);
    DOM.closePasscodeOverlay?.addEventListener('click', closePasscode);

    // FIXED: Fetch passcode dynamically on click to ensure config.js is loaded
    const handlePasscodeSubmit = () => {
        const currentPasscode = window.ADMIN_PASSCODE || "1234";
        
        if (DOM.passcodeInput.value === currentPasscode) {
            closePasscode();
            openDashboard();
        } else {
            DOM.passcodeError.style.display = 'block';
            DOM.passcodeInput.value = '';
            DOM.passcodeInput.focus();
        }
    };

    DOM.submitPasscodeBtn?.addEventListener('click', handlePasscodeSubmit);
    DOM.passcodeInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') handlePasscodeSubmit(); });

    const closeDashboard = () => {
        DOM.adminModal?.classList.remove('show');
        if (unsubscribeSnapshot) unsubscribeSnapshot();
    };

    DOM.closeAdminBtn?.addEventListener('click', closeDashboard);
    DOM.closeAdminOverlay?.addEventListener('click', closeDashboard);
}

// ==========================================
// 3. Firebase & Enhanced Analytics Tracking
// ==========================================
async function initAuth() {
    if (!auth) return;
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
    } catch (err) {
        console.error("Firebase Auth Error:", err);
    }
}

async function initFirebase() {
    // Dynamically fetch config to ensure it is loaded
    const activeConfig = window.myFirebaseConfig;

    if (activeConfig && activeConfig.apiKey) {
        // Initialize Firebase only once
        if (!app) {
            app = initializeApp(activeConfig);
            auth = getAuth(app);
            db = getFirestore(app);
        }

        try {
            await initAuth();
            const user = auth.currentUser;
            if (!user) return;

            const isOwner = typeof __initial_auth_token !== 'undefined' && !!__initial_auth_token;

            if (!isOwner && !sessionStorage.getItem('visit_logged')) {
                let ipAddress = "Unknown IP";
                let locationStr = "Unknown Location";
                let ispStr = "Unknown ISP";

                // Fetch IP, Location, and ISP via GeoJS
                try {
                    const geoResponse = await fetch('https://get.geojs.io/v1/ip/geo.json');
                    const geoData = await geoResponse.json();
                    ipAddress = geoData.ip || "Unknown IP";
                    locationStr = geoData.city && geoData.country ? `${geoData.city}, ${geoData.country}` : "Unknown Location";
                    ispStr = geoData.organization || "Unknown ISP";
                } catch (e) {
                    console.warn("Failed to fetch Geolocation data.");
                }

                // Gather open browser metadata
                const ua = navigator.userAgent;
                const referrer = document.referrer || "Direct / Bookmark";
                const language = navigator.language || "Unknown";
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown";
                
                // Parse Browser
                let browser = "Unknown Browser";
                if(ua.includes("Firefox")) browser = "Firefox";
                else if(ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
                else if(ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
                else if(ua.includes("Edg")) browser = "Edge";

                // Parse OS
                let os = "Unknown OS";
                if(ua.includes("Win")) os = "Windows";
                else if(ua.includes("Mac")) os = "MacOS";
                else if(ua.includes("Linux")) os = "Linux";
                else if(ua.includes("Android")) os = "Android";
                else if(ua.includes("like Mac")) os = "iOS";

                const visitsRef = collection(db, 'artifacts', appId, 'public', 'data', 'portfolio_visits');

                // Send the enriched payload to Firestore
                await addDoc(visitsRef, {
                    uid: user.uid,
                    ip: ipAddress,
                    location: locationStr,
                    isp: ispStr,
                    browser: browser,
                    os: os,
                    isMobile: /Mobi|Android/i.test(ua),
                    screen: `${window.screen.width}x${window.screen.height}`,
                    language: language,
                    timezone: timezone,
                    referrer: referrer,
                    timestamp: serverTimestamp()
                });
                
                sessionStorage.setItem('visit_logged', 'true');
            }
        } catch (error) {
            console.error("Analytics Setup Error:", error);
        }
    }
}

// ==========================================
// 4. Admin Dashboard Data Fetching & Rendering
// ==========================================
async function openDashboard() {
    if (!DOM.adminModal || !DOM.visitLogBody) return;

    const activeConfig = window.myFirebaseConfig;

    if (!activeConfig || !activeConfig.apiKey) {
        DOM.adminModal.classList.add('show');
        DOM.visitLogBody.innerHTML = '<tr><td colspan="4" style="color:#ef4444; text-align:center; padding: 2rem;"><strong>Configuration Missing</strong><br>Firebase is not configured.<br><br>The <code>config.js</code> file could not be found or is empty.</td></tr>';
        return;
    }

    let user = auth?.currentUser;
    if (!user) {
        await initAuth();
        user = auth?.currentUser;
    }
    
    if (!user) {
        DOM.adminModal.classList.add('show');
        DOM.visitLogBody.innerHTML = '<tr><td colspan="4" style="color:#ef4444; text-align:center;">Authentication error. Please refresh the page and try again.</td></tr>';
        return;
    }

    DOM.adminModal.classList.add('show');
    const visitsRef = collection(db, 'artifacts', appId, 'public', 'data', 'portfolio_visits');
    const q = query(visitsRef); 

    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        const visits = [];
        snapshot.forEach(doc => visits.push({ id: doc.id, ...doc.data() }));
        
        visits.sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));

        const totalViews = visits.length;
        const uniqueUsers = new Set(visits.map(v => v.uid)).size;
        const mobileCount = visits.filter(v => v.isMobile).length;
        const desktopCount = totalViews - mobileCount;

        if(DOM.statTotalViews) DOM.statTotalViews.innerText = totalViews;
        if(DOM.statUniqueUsers) DOM.statUniqueUsers.innerText = uniqueUsers;
        if(DOM.statDeviceSplit) DOM.statDeviceSplit.innerText = `${desktopCount} Desktop / ${mobileCount} Mobile`;

        DOM.visitLogBody.innerHTML = '';
        
        if (visits.length === 0) {
            DOM.visitLogBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No visitors yet.</td></tr>';
            return;
        }

        // Render the top 20 recent visitors with the new enriched data
        visits.slice(0, 20).forEach(visit => {
            const date = visit.timestamp ? new Date(visit.timestamp.toDate()).toLocaleString() : 'Just now';
            const ip = visit.ip || 'Unknown IP';
            const location = visit.location || 'Unknown Location';
            const isp = visit.isp || 'Unknown ISP';
            const browser = visit.browser || 'Unknown';
            const os = visit.os || 'Unknown';
            const screen = visit.screen || 'N/A';
            const referrer = visit.referrer || 'Direct / Bookmark';
            const language = visit.language || 'Unknown';
            const timezone = visit.timezone || 'Unknown';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div style="font-weight: bold; color: white;">${date}</div>
                    <div style="font-size: 0.85em; color: #A1A1AA; margin-top: 4px;">
                        <i class="fas fa-map-marker-alt" style="color: var(--accent-color); margin-right: 4px;"></i>${location}
                    </div>
                </td>
                <td>
                    <div style="color: white;">${browser}</div>
                    <div style="font-size: 0.85em; color: #A1A1AA; margin-top: 4px;">
                        ${os} ${visit.isMobile ? '📱' : '💻'} (${screen})
                    </div>
                </td>
                <td style="font-family: monospace;">
                    <span style="color: var(--accent-color);">${ip}</span><br>
                    <span style="font-size: 0.8em; color: #A1A1AA; display: inline-block; margin-top: 4px;">${isp}</span>
                </td>
                <td>
                    <div style="color: white; font-size: 0.9em; word-break: break-all;">
                        <i class="fas fa-link" style="color: #A1A1AA; margin-right: 4px;"></i>${referrer}
                    </div>
                    <div style="font-size: 0.8em; color: #A1A1AA; margin-top: 4px;">
                        ${language} | ${timezone}
                    </div>
                </td>
            `;
            DOM.visitLogBody.appendChild(tr);
        });
    }, (error) => {
        console.error("Dashboard Error:", error);
        DOM.visitLogBody.innerHTML = '<tr><td colspan="4" style="color:#ef4444; text-align:center;">Error fetching data. Ensure database is connected and security rules are configured.</td></tr>';
    });
}

// ==========================================
// 5. Initialize Application
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    initAdminTriggers();
    initFirebase();
});