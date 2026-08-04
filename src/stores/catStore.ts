// src/stores/catStore.ts
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"

type Cat = {
  id: string
  name: string
}

type CatStoreState = {
  cats: Cat[]
  addCat: (name: string) => void
  removeCat: (id: string) => void
}

export const useCatStore = create<CatStoreState>()(
  immer((set) => ({
    cats: [],

    addCat: (name) =>
      set((state) => {
        state.cats.push({
          id: crypto.randomUUID(),
          name,
        })
      }),

    removeCat: (id) =>
      set((state) => {
        state.cats = state.cats.filter((cat) => cat.id !== id)
      }),
  }))
)