import { defineConfig } from "vite";

export default defineConfig({
  base: "/Examen2_AlizeeEleonor/", 
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
});