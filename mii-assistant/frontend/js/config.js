// js/config.js
//
// Laissez window.MII_API_BASE_URL = "" (chaîne vide) tant que le frontend
// est servi PAR le même serveur que l'API (c'est le cas par défaut avec
// `npm start` dans /backend).
//
// ⚠️ IMPORTANT pour la version Android (Capacitor) : une fois empaquetée,
// l'app n'a plus de serveur "même origine" — elle tourne en local sur le
// téléphone. Vous DEVEZ alors renseigner ici l'URL complète de votre backend
// hébergé en ligne (ex: "https://api.mon-app-mii.com"), puis relancer
// `npx cap sync android` dans mobile-capacitor/. Voir le README, section
// "Construire l'app Android".

window.MII_API_BASE_URL = "";
