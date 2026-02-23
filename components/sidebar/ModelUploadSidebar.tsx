"use client";

import React, { useState, useRef, useEffect } from 'react';
import { 
  Button,
  Tooltip,
  Spinner, 
  Dropdown,
  DropdownTrigger, 
  DropdownMenu, 
  DropdownItem,
  Modal, 
  ModalContent, 
  ModalHeader, 
  ModalBody, 
  ModalFooter,
  useDisclosure 
} from "@heroui/react";
import { 
  PanelLeftClose, 
  PanelLeftOpen,
  FileText, 
  Box, 
  X, 
  FileUp,
  Download,
  Focus,
  Trash2,
  CloudDownload,
  RefreshCw,
  Loader2,
  ChevronRight,
  BrushCleaning
} from 'lucide-react';
import * as OBC from "@thatopen/components"
import { useUpload } from "@/context/UploadContext";
import { getUserModels, deleteModel } from '@/lib/actions/model.action';
import { Model,UIModel } from '../../types/upload';
import * as THREE from 'three';
import { FileItem } from '@/app/(uploadAndDashboard)/upload/page';


interface ModelUploadSidebarProps {
  getComponents?:() => OBC.Components | null;
  onFilesChange: (files: FileItem[]) => void;
  onSelectFile: (file: FileItem | null) => void;
  onLoadModel: (buffer: ArrayBuffer,modelName:string) => void;
  onFocusAllModel: () => void;
  onFocusModel:(modelId:string) => void;
  onExportModelFrag: (modelId: string) => Promise<ArrayBuffer | null>;
  onDeleteModel: (modelId: string) => void;
  selectedFileId: string | null;
}

const ModelUploadSidebar = ({ 
  getComponents,
  onFilesChange, 
  onSelectFile,
  onLoadModel,
  onFocusAllModel,
  onFocusModel, 
  onDeleteModel,
  onExportModelFrag,
  selectedFileId 
}: ModelUploadSidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completedModels, setCompletedModels] = useState<UIModel[]>([]);
  // 用來追蹤哪一個模型正在下載中 (顯示轉圈圈)
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  //從 Context 取得 uppy 實例
  const { uppy } = useUpload();
  const {isOpen, onOpen, onOpenChange} = useDisclosure();// 控制 Modal 開關的 Hook
  const [modelToDelete, setModelToDelete] = useState<string | null>(null);//暫存「當前要刪除的模型Name」
  const [modelIdToDelete, setModelIdToDelete] = useState<string | null>(null);//暫存「當前要刪除的模型id」
  const [isLoadedModelsExpanded, setIsLoadedModelsExpanded] = useState<boolean>(true);

  // 撈取model資料
  const fetchUserModels = async () => {
    setIsLoading(true);
    try {
      const result = await getUserModels();
      
      if (result.success && result.data) {
        // 將 DB 資料轉換成 FileItem 格式
        const dbFiles: UIModel[] = result.data.map((model) => {
          
          return {
            id: model.id,
            shortId: model.shortId,
            name: model.name,
            fileId: model.fileId,
            size: model.size, // 這裡已經是 String 了
            status: model.status as "uploading" | "processing" | "success" | "error",
            createdAt: model.createdAt, // 這裡通常是 Date 或 ISO String
            type: "3d",
          };
        });

        setCompletedModels(dbFiles);
        // 如果需要同步給父層，也可以在這裡呼叫 onFilesChange(dbFiles);
      }
    } catch (error) {
      console.error("Error loading models:", error);
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    fetchUserModels();
  }, []); // 空陣列代表只在掛載時執行一次
  // 處理檔案上傳邏輯
  const handleFiles = (uploadedFiles: FileList | null) => {
    if (!uploadedFiles) return;

    // 1. 處理本地狀態 (保持你原本的邏輯，讓 Viewer 可以直接看)
    const newFiles: FileItem[] = Array.from(uploadedFiles).map(file => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const type = (extension === 'ifc' || extension === 'frag') ? '3d' : 'pdf';
      // testing for telling whether the file loader work
      console.log(`File uploaded: ${file.name}, Extension: .${extension}, Type: ${type}`);
      
      // 我們只上傳 IFC 檔案 (根據你的需求)
      if (extension === 'ifc') {
        try {
          uppy.addFile({
            name: file.name, // 使用檔名作為識別
            type: file.type,
            data: file,      // 傳入原始 File 物件
            source: 'Local',
          });
          console.log(`[Uppy] 檔案 ${file.name} 已加入上傳佇列`);
        } catch (err) {
          // Uppy 如果遇到重複檔案會報錯，這裡攔截避免影響 UI
          console.warn(`[Uppy] 無法加入檔案 (可能已存在):`, err);
        }
      }

      return {
        id: Math.random().toString(36).substr(2, 9),
        file,
        type,
        name: file.name
      };
    });

    const updatedFiles = [...files, ...newFiles];
    setFiles(updatedFiles);
    onFilesChange(updatedFiles);

    // 處理完後清空 input 的值
    if (fileInputRef.current) {
        fileInputRef.current.value = ""; 
    }
    // 如果是第一個上傳的檔案，自動選取
    if (files.length === 0 && newFiles.length > 0) {
      onSelectFile(newFiles[0]);
    }
  };
  // 當使用者按下垃圾桶時：只做「紀錄 ID」跟「打開 Modal」
  const openDeleteModal = (name: string,id:string) => {
    setModelToDelete(name); // 記住要刪誰
    setModelIdToDelete(id);
    onOpen(); // 打開確認視窗
  };
  // 使用者在 Modal 按下「確認」時：真正執行刪除
  const handleConfirmDelete = async () => {
    if (!modelToDelete || !modelIdToDelete) return;
    onOpenChange();
    removeModelFromScene(modelToDelete);
    deleteModelFromStorage(modelToDelete,modelIdToDelete);
  }

  const downloadAndLoadFrag = async(fileId:string, modelName:string, e: React.MouseEvent) => {
    e.stopPropagation();
    if(loadingModelId) return;

    try{
      setLoadingModelId(modelName);
      console.warn(fileId);
      const response = await fetch(`/api/frags/${fileId}`);

      if (!response.ok) {
        throw new Error("下載失敗");
      }

      const buffer = await response.arrayBuffer();

      console.log(`📦 模型下載成功: ${modelName}, 大小: ${buffer.byteLength}`);

      onLoadModel(buffer, modelName);
      onSelectFile({
        id:fileId,
        // 騙術：給它一個同名的空檔案 (內容是空陣列 [])
        file: new File([], modelName, { type: 'application/octet-stream' }),
        type: '3d',
        name:modelName,
        fileid:fileId,
      })
    }catch(error){
      console.error("載入失敗:", error);
    }finally{
      setLoadingModelId(null);
    }
  }

  const focusModel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if(getComponents){
      const components = getComponents();
      if(components){
        const fragments = components.get(OBC.FragmentsManager);
        const model = fragments.list.get(id);

        if(model){
          const worlds = components.get(OBC.Worlds);
          const world = worlds.list.values().next().value;

          if(world && world.camera.controls){
            
            model.object.updateMatrixWorld(true);
            // 確保模型物件的矩陣與包圍盒已更新不然聚焦空盒會黑屏
            const box = new THREE.Box3().setFromObject(model.object);
            if (box.isEmpty()) {
              console.warn(`模型 ${id} 的包圍盒為空，延遲 100ms 後重試`);
              return;
            }

            world.camera.controls?.fitToBox(model.object,true);       
            console.log(`聚焦至模型: ${id}`);
          }
        }else {
            console.warn(`找不到模型 ${id} 無法聚焦`);
        }
      }
    }
    // onFocusModel(id);

  }
  const removeModelFromScene = (modelName:string) => {
    onDeleteModel(modelName);
  }
  const deleteModelFromStorage = async(modelName:string,fileId:string) => {
    // 先從場景中移除
    onDeleteModel(modelName);

    deleteModel(fileId);

    fetchUserModels();

  }
  // 移除檔案以及模型
  const removeFile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const fileToDelete: FileItem | undefined = files.find(f =>f.id === id);

    if(fileToDelete && fileToDelete.type === '3d' && onDeleteModel){
      const modelId = fileToDelete.name.replace(/\.(ifc|frag)$/i, "");
      onDeleteModel(modelId);
    }

    const updatedFiles = files.filter(f => f.id !== id);
    setFiles(updatedFiles);
    onFilesChange(updatedFiles);
    if (selectedFileId === id) {
      onSelectFile(updatedFiles.length > 0 ? updatedFiles[0] : null);
    }
  };

  // 拖放處理
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  if (isCollapsed) {
    return (
      <div className="relative z-50 flex justify-center items-center w-10 h-10 rounded-xl transition-all duration-300">
        <Button
          isIconOnly
          variant="light"
          onPress={() => setIsCollapsed(false)}
          aria-label="Expand sidebar"
          className="text-white rounded-xl bg-[#3F3F46] transition-all duration-300 shadow-[0px_0px_2px_0px_#000000B2,inset_0px_-4px_4px_0px_#00000040,inset_0px_4px_2px_0px_#FFFFFF33]"
        >
          <PanelLeftOpen size={20} />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative z-30 shadow-[inset_0px_1px_5px_rgba(255,255,255,0.8),inset_0px_-1px_3px_rgba(0,0,0,0.8)] dark:shadow-[inset_0px_2px_1px_rgba(255,255,245,0.2),inset_0px_-2px_8px_rgba(0,0,0,0.4),0px_25px_50px_-12px_#00000040] rounded-[14px] h-full w-72 bg-[#18181B] flex flex-col transition-all duration-300 overflow-hidden">
      {/* 標題欄 */}
      <div className="p-4 flex justify-between items-center border-b border-[#FFFFFF1A]">
        <h3 className="font-inter text-[#A1A1AA] flex items-center gap-2">
          <Box size={18} />
          2D/ 3D Models
        </h3>
        <Button
          isIconOnly
          variant="light"
          onPress={() => setIsCollapsed(true)}
          aria-label="Collapse sidebar"
          className="text-white rounded-xl bg-[#3F3F46] shadow-[0px_0px_2px_0px_#000000B2,inset_0px_-4px_4px_0px_#00000040,inset_0px_4px_2px_0px_#FFFFFF33]"
        >
          <PanelLeftClose size={20} />
        </Button>
      </div>

      {/* 上傳區域 (Importing) */}
      <div className="p-4">
        <p className="text-[#A1A1AA] font-inter text-xs mb-2 uppercase">Importing</p>
        <div 
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className="shadow-[inset_0px_3px_5px_1px_#000000A3,inset_0px_-1px_2px_#00000099,0px_3px_1.8px_#FFFFFF29,0px_-2px_1.9px_#00000040,0px_0px_4px_#FBFBFB3D] rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#D70036] transition-colors bg-[#27272A]"
        >
          <div>
            <FileUp size={32} className="text-white" />
          </div>
          <p className="text-white text-xs text-center">
            Drop your files here or <span className="text-[#D70036] hover:underline">browse</span>
          </p>
          <input
            type="file"
            ref={fileInputRef}
            aria-label="Upload 3D models or PDF files"
            className="hidden"
            multiple
            accept=".ifc,.frag,.pdf"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {/* 已載入列表 (Loaded Models) */}
      <div className="flex-grow overflow-y-auto p-4 border-t border-[#FFFFFF1A]">
        <div className='flex items-center justify-between px-2'>
          <p className="font-inter text-[#A1A1AA] text-xs mb-2 uppercase">Cloud Models</p>
          <div className='flex gap-2'>
            <Tooltip content={`Refresh`} placement='bottom'>
              <button
                onClick={(e)=>{e.preventDefault(); fetchUserModels();}}
                aria-label={`Focus whole`}
                className={`text-white`} 
                >
                <RefreshCw size={14} className='mb-3'/>
              </button>
            </Tooltip>
            <Tooltip content={`Focus All`} placement='bottom'>
              <button
                onClick={(e)=>{e.preventDefault(); onFocusAllModel();}}
                aria-label={`Focus whole`}
                className={`text-white`} 
                >
                <Focus size={14} className='mb-3'/>
              </button>
            </Tooltip>
          </div> 
        </div>
        <div className="flex flex-col gap-2">
          {isLoading ? (
            <div className="flex justify-center p-4">
                {/* 如果沒有 HeroUI Spinner，可以用文字代替 */}
                <Spinner className="text-xs text-gray-500">Loading models...</Spinner>
            </div>
          ) : completedModels.length === 0 ? (
            <p className="text-gray-500 text-xs italic text-center mt-4">No models loaded yet</p>
          ) : (
            completedModels.map((fileItem) => (
              <div 
                key={fileItem.id}
                onClick={() => {

                  const isPdf = fileItem.name.toLowerCase().endsWith('.pdf');

                  onSelectFile({
                    id:fileItem.id,
                    // 騙術：給它一個同名的空檔案 (內容是空陣列 [])
                    file: new File([], fileItem.name, { type: 'application/octet-stream' }),
                    type: isPdf ? 'pdf' : '3d',
                    name:fileItem.name,
                    fileid:fileItem.fileId,
                  })
                }
              }
                className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                  selectedFileId === fileItem.fileId 
                  ? 'bg-[#D70036] text-white shadow-lg' 
                  : 'bg-[#27272A] text-gray-300 hover:bg-[#3F3F46]'
                }`}
              >
                {fileItem.type === '3d' ? <Box width={20} height={20} className='shrink-0'/> : <FileText size={20} />}
                <Tooltip content={`${fileItem.name}`} placement='bottom'>
                  <span className="text-sm truncate flex-grow">                    
                      {fileItem.name}
                  </span>
                </Tooltip>
                {fileItem.name === loadingModelId ? (<Loader2 size={16}/>)
                :( 
                  <>
                    <Tooltip content={`Show in Viewer`} placement='bottom'>
                      <button
                        onClick={(e) => downloadAndLoadFrag(fileItem.fileId,fileItem.name, e)}
                        aria-label={`Load ${fileItem.name}`}
                        className={`${fileItem.type === 'pdf' ? "hidden":null} text-gray-300 hover:text-white`}
                        >
                        <CloudDownload size={16}/>
                      </button>
                    </Tooltip>
                    <Tooltip content={`Focus`} placement='bottom'>
                      <button
                        onClick={(e) => focusModel(fileItem.name, e)}
                        aria-label={`Focus ${fileItem.name}`}
                        className={`${fileItem.type === 'pdf' ? "hidden":null} text-gray-300 hover:text-white`}
                        >
                        <Focus size={16}/>
                      </button>
                    </Tooltip>
                      <Dropdown
                        placement='right-start'
                      >
                        <DropdownTrigger>
                          <div className='flex'>
                            <Tooltip content="More Options" placement="bottom">
                              <button>
                                <ChevronRight size={16} className="shrink-0" />
                              </button>
                            </Tooltip>
                          </div>
                        </DropdownTrigger>  
                        <DropdownMenu 
                          aria-label='more options' 
                          variant='flat'
                          itemClasses={{
                            base:"text-black dark:text-white",
                          }}
                        >
                          <DropdownItem 
                            key="Remove From Scene" 
                            onPress={() => removeModelFromScene(fileItem.name)} 
                            endContent={<BrushCleaning size={20}/>}
                          >
                            Remove From Scene
                          </DropdownItem>
                          <DropdownItem 
                            key="Delete From Storage" 
                            onPress={() => openDeleteModal(fileItem.name,fileItem.fileId)} 
                            endContent={<Trash2 size={20} className='text-danger'/>}
                            color="danger"
                            classNames={{
                              title:"text-danger",
                            }}
                          >
                            Delete From Storage
                          </DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                  </>
                )  
                }
              </div>
            ))
          )}
        </div>
      </div>
      {/* 二次確認刪除模型 */}
      <Modal 
        isOpen={isOpen} 
        onOpenChange={onOpenChange}
        className="dark text-white bg-[#18181B] border border-[#27272A]"
        backdrop="blur"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Confirm Deletion</ModalHeader>
              <ModalBody>
                <p className="text-gray-400">
                  Are you sure you want to delete this model? 
                  <br/>
                  This action cannot be undone and will remove the file from the database and cloud storage.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button color="default" variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button color="danger" onPress={handleConfirmDelete}>
                  Delete
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
};

export default ModelUploadSidebar;