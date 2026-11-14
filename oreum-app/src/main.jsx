import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./lib/chartSetup.js";
import "./styles.css";
import Layout from "./components/Layout.jsx";
import Simulator from "./pages/Simulator.jsx";
import Analysis from "./pages/Analysis.jsx";
import Review from "./pages/Review.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Simulator />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="review" element={<Review />} />
          <Route path="*" element={<Simulator />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
