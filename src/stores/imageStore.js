import { create } from 'zustand'

export const IMAGE_SUFFIX_OTHER = '其它'

export const useImageStore = create((set) => ({
  imageFile: null,
  imageFiles: [],
  selectedImagePath: null,
  noteDraft: '',
  imageInfo: null,
  suffixOption: '删除',
  customSuffix: '',

  setImageFile: (imageFile) => set({ imageFile }),
  setImageFiles: (imageFiles) => set({ imageFiles }),
  setSelectedImagePath: (selectedImagePath) => set({ selectedImagePath }),
  setNoteDraft: (noteDraft) => set({ noteDraft }),
  setImageInfo: (imageInfo) => set({ imageInfo }),
  setSuffixOption: (suffixOption) => set({ suffixOption }),
  setCustomSuffix: (customSuffix) => set({ customSuffix }),
  loadImageInfo: (info) => set({
    imageFile: info,
    imageFiles: info.imageFiles || [],
    selectedImagePath: info.filePath || null,
    noteDraft: info.note?.content || '',
    imageInfo: info.info || null,
  }),
  clearImage: () => set({
    imageFile: null,
    imageFiles: [],
    selectedImagePath: null,
    noteDraft: '',
    imageInfo: null,
  }),
}))
