import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCwE6QPvzmcSPqW7F8rMEHLlBmDxgSsfYY",
  authDomain: "hu-clientmaintenance.firebaseapp.com",
  projectId: "hu-clientmaintenance",
  storageBucket: "hu-clientmaintenance.firebasestorage.app",
  messagingSenderId: "499547149003",
  appId: "1:499547149003:web:a28a1adf076f32d845414e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
