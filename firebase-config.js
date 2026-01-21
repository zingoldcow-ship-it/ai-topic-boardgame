// firebase-config.js
// (현재 프로젝트는 firebase *compat* 방식을 사용합니다.)
// - HTML에서 firebase-app-compat.js / firebase-firestore-compat.js가 먼저 로드된 뒤
//   이 파일이 로드되어야 합니다.
//
// 아래 값은 사용자가 제공한 Firebase Web App 설정을 반영한 것입니다.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAPcmtiiYEcSZQldjLar9-Yzis5wM-Ncac",
  authDomain: "ai-matter-boardgame.firebaseapp.com",
  projectId: "ai-matter-boardgame",
  storageBucket: "ai-matter-boardgame.firebasestorage.app",
  messagingSenderId: "792165997483",
  appId: "1:792165997483:web:f7c6bd1fe703773bc210ee",
  measurementId: "G-GGTMPTG07X"
};

// 여기서 바로 초기화(중복 초기화 방지)
try {
  if (window.firebase && firebase.initializeApp) {
    if (!firebase.apps || (firebase.apps && firebase.apps.length === 0)) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
    }
  }
} catch (e) {
  console.warn("[firebase-config] initializeApp skipped/failed:", e);
}
