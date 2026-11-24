import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import UserApp from "./user/UserApp.jsx";

// 관리자 화면은 차트 라이브러리를 쓰므로 필요할 때만 불러온다 (사용자 화면을 가볍게)
const AdminApp = lazy(() => import("./admin/AdminApp.jsx"));
const PublicData = lazy(() => import("./admin/PublicData.jsx")); // 공개 데이터·분석 (로그인 없음)

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div className="user"><UserApp /></div>} />
        <Route path="/admin/*" element={<Suspense fallback={<p style={{ padding: 40, color: "#8b95a1" }}>불러오는 중…</p>}><AdminApp /></Suspense>} />
        <Route path="/data/*" element={<Suspense fallback={<p style={{ padding: 40, color: "#8b95a1" }}>불러오는 중…</p>}><PublicData /></Suspense>} />
        {/* 예전 주소 */}
        <Route path="/analysis" element={<Navigate to="/data/analysis" replace />} />
        <Route path="/ai" element={<Navigate to="/data/ai" replace />} />
        <Route path="/review" element={<Navigate to="/data/review" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
