// firebase-config.js
// Firebase Web App 구성 값을 여기에 붙여넣으세요.
// Firebase Console > Project settings > General > Your apps > SDK setup and configuration
//
// 중요:
// 1) 이 파일은 firebase-app-compat.js / firebase-firestore-compat.js "아래"에서 로드되어야 합니다.
// 2) apiKey, authDomain, projectId 등은 본인 프로젝트 값으로 교체하세요.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAPcmtiiYEcSZQldjLar9-Yzis5wM-Ncac",
  authDomain: "ai-matter-boardgame.firebaseapp.com",
  projectId: "ai-matter-boardgame",
  storageBucket: "ai-matter-boardgame.firebasestorage.app",
  messagingSenderId: "792165997483",
  appId: "1:792165997483:web:f7c6bd1fe703773bc210ee"
};

// 옵션: 여기서 바로 초기화(중복 초기화 방지 포함)
try {
  if (window.firebase && firebase.initializeApp) {
    if (!firebase.apps || (firebase.apps && firebase.apps.length === 0)) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
    }
  }
} catch (e) {
  // 초기화 실패 시에도 app.js에서 다시 시도할 수 있도록 치명 오류로 만들지 않음
  console.warn("[firebase-config] initializeApp skipped/failed:", e);
}
