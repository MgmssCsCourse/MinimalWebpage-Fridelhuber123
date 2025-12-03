// js/auth.js

// 1. CONFIG (REPLACE WITH YOUR FIREBASE KEYS from Console -> Project Settings)
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "...",
    appId: "..."
};

// 2. INIT
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// 3. EXPORTED FUNCTIONS
export const UserData = {
    uid: null,
    coins: 0,
    currentSkin: 'default',
    skins: ['default']
};

export function initAuth(onLoginSuccess) {
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('email');
    const passInput = document.getElementById('password');

    btnLogin.addEventListener('click', () => {
        const email = emailInput.value;
        const pass = passInput.value;
        
        auth.signInWithEmailAndPassword(email, pass)
            .then((cred) => handleUser(cred.user, onLoginSuccess))
            .catch(() => {
                // If login fails, try register automatically
                auth.createUserWithEmailAndPassword(email, pass)
                    .then((cred) => {
                        // Create initial DB entry
                        db.collection('users').doc(cred.user.uid).set({
                            coins: 100,
                            skins: ['default'],
                            currentSkin: 'default'
                        });
                        handleUser(cred.user, onLoginSuccess);
                    })
                    .catch(e => document.getElementById('auth-msg').innerText = e.message);
            });
    });
}

function handleUser(user, callback) {
    UserData.uid = user.uid;
    
    // Load Firestore Data
    db.collection('users').doc(user.uid).get().then(doc => {
        if(doc.exists) {
            const data = doc.data();
            UserData.coins = data.coins;
            UserData.skins = data.skins;
            UserData.currentSkin = data.currentSkin;
            
            // Update UI
            document.getElementById('coin-display').innerText = UserData.coins;
            document.getElementById('username-display').innerText = user.email.split('@')[0].toUpperCase();
            
            // Hide Auth, Show Lobby
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('lobby-ui').style.display = 'block';
            
            callback(); // Start the 3D scene in Lobby Mode
        }
    });
}

export function saveSkin(skinId) {
    if(UserData.uid) {
        db.collection('users').doc(UserData.uid).update({ currentSkin: skinId });
        UserData.currentSkin = skinId;
    }
}