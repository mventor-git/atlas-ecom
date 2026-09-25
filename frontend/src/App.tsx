import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Manager } from "@/routes/manager";
import { Storefront } from "@/routes/storefront";
import { ThemeProvider } from "@/lib/theme";

/**
 * The storefront and the ecom-manager are one build with two routes. The
 * contract treats them as separate frontends that may be split later; nothing in
 * either page reaches across the other except the shared token layer, so the
 * split is a packaging change and not a rewrite.
 */
export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Storefront />} />
          <Route path="/manager" element={<Manager />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
