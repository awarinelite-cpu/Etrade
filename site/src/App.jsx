import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import UpgradeSuccess from "./pages/UpgradeSuccess";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/upgrade-success" element={<UpgradeSuccess />} />
      </Routes>
    </BrowserRouter>
  );
}
