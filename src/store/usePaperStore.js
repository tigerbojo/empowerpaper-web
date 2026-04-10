import { create } from 'zustand'

const initialState = {
  originalImage: null,
  cleanedImage: null,
  cleanedOcrImage: null,
  selectedEditImage: null,
  selectedEditImageKind: 'cleaned',
  cleanupMode: 'opencv',
  darkness: 1.0,
  cleanupProcessor: null,
  currentPaperId: null,
  currentJobId: null,
  crops: [],
  tags: [],
  generatedPdfUrl: null,
  uploadProgress: 0,
  uploadStage: 'idle',
  processingStatus: 'idle',
  examSettings: {
    title: '數學複習卷',
    paperSize: 'A4 直式',
    columns: 1,
  },
}

const usePaperStore = create((set) => ({
  ...initialState,
  setUploadProgress: (uploadProgress) => set({ uploadProgress }),
  setUploadStage: (uploadStage) => set({ uploadStage }),
  setOriginalImage: (originalImage) => set({ originalImage }),
  setCleanedImage: (cleanedImage) => set({ cleanedImage }),
  setCleanedOcrImage: (cleanedOcrImage) => set({ cleanedOcrImage }),
  setSelectedEditImage: (selectedEditImage, selectedEditImageKind = 'cleaned') =>
    set({ selectedEditImage, selectedEditImageKind }),
  setCleanupMode: (cleanupMode) => set({ cleanupMode }),
  setDarkness: (darkness) => set({ darkness }),
  setCleanupProcessor: (cleanupProcessor) => set({ cleanupProcessor }),
  setCurrentPaperId: (currentPaperId) => set({ currentPaperId }),
  setCurrentJobId: (currentJobId) => set({ currentJobId }),
  setProcessingStatus: (processingStatus) => set({ processingStatus }),
  addCrop: (crop) => set((state) => ({ crops: [...state.crops, crop] })),
  updateCrop: (cropId, patch) =>
    set((state) => ({
      crops: state.crops.map((crop) => (crop.id === cropId ? { ...crop, ...patch } : crop)),
    })),
  setCrops: (crops) => set({ crops }),
  removeCrop: (cropId) => set((state) => ({ crops: state.crops.filter((crop) => crop.id !== cropId) })),
  setTags: (tags) => set({ tags }),
  setGeneratedPdfUrl: (generatedPdfUrl) => set({ generatedPdfUrl }),
  setExamSettings: (examSettings) => set((state) => ({ examSettings: { ...state.examSettings, ...examSettings } })),
  resetPaper: () => set(initialState),
}))

export default usePaperStore
