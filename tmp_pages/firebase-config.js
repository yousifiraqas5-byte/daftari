/* =========================================================
   DAFTARI - Firebase Configuration
   Project: daftari-27563
=========================================================

    الإعداد مكتمل لمشروع daftari-27563.

    ما يبقى فقط في Firebase Console (مرة واحدة):

    1) Authentication > Sign-in method > Email/Password > Enable
    2) Firestore Database > Create database ثم الصِق قواعد الحماية
       (Firestore > Rules):

           rules_version = '2';
           service cloud.firestore {
             match /databases/{database}/documents {
               match /users/{uid}/{document=**} {
                 allow read, write:
                   if request.auth != null
                   && request.auth.uid == uid;
               }
             }
           }

    عند أول تسجيل دخول تُرفع البيانات المحلية القائمة تلقائياً
    إلى الحساب، ولا تُحذف أي بيانات محلية إطلاقاً.

    القواعد الكاملة والمحدّثة موجودة في firestore.rules
    (نفّذ: firebase deploy --only firestore:rules).

    ملاحظة: لم نُضِف Analytics عمداً (غير مطلوب للمزامنة
    ويوفر صلاحيات إضافية).
========================================================= */

window.FIREBASE_CONFIG = {
    apiKey: "AIzaSyD3RjXmM6GGlYicfIgZGAn1MF85FtEmlfo",
    authDomain: "daftari-27563.firebaseapp.com",
    projectId: "daftari-27563",
    storageBucket: "daftari-27563.firebasestorage.app",
    messagingSenderId: "537944000275",
    appId: "1:537944000275:web:cbdf61abf2d7632d877ce6",
    measurementId: "G-N6GWW9RVNW"
};
