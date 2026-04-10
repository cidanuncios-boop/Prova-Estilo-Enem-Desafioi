/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Upload, 
  FileText, 
  Settings, 
  Play, 
  Download, 
  Plus, 
  Edit2, 
  Trash2, 
  CheckCircle2,
  Loader2,
  ChevronRight,
  Printer,
  Share2,
  Copy,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// PDF.js worker setup - Using a more reliable CDN and matching the version
const PDF_WORKER_URL = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

// Types
interface Question {
  id: string;
  supportText: string;
  questionText: string;
  alternatives: string[];
  correctAnswer: number; // Index 0-4
}

interface ExamData {
  title: string;
  subject: string;
  date: string;
  questions: Question[];
}

interface PageData {
  leftCol: Question[];
  rightCol: Question[];
}

export default function App() {
  // State
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState<string>('');
  const [isParsing, setIsParsing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [numQuestions, setNumQuestions] = useState(10);
  const [numAlternatives, setNumAlternatives] = useState(5);
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [examTitle, setExamTitle] = useState('Simulado ENEM');
  const [examSubject, setExamSubject] = useState('');
  const [examDate, setExamDate] = useState(new Date().toLocaleDateString('pt-BR'));
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [paginatedPages, setPaginatedPages] = useState<PageData[]>([]);
  const [showShareTooltip, setShowShareTooltip] = useState(false);
  const [showGabarito, setShowGabarito] = useState(true);

  const previewRef = useRef<HTMLDivElement>(null);

  const saveToLocal = () => {
    if (!examData) return;
    const blob = new Blob([JSON.stringify(examData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${examData.title.replace(/\s+/g, '_')}_data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadFromLocal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        setExamData(data);
        setExamTitle(data.title);
        setExamSubject(data.subject);
        setExamDate(data.date);
      } catch (err) {
        alert('Erro ao carregar o arquivo JSON.');
      }
    };
    reader.readAsText(file);
  };

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setShowShareTooltip(true);
    setTimeout(() => setShowShareTooltip(false), 2000);
  };

  // File parsing logic
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setIsParsing(true);

    try {
      const fileType = uploadedFile.name.split('.').pop()?.toLowerCase();
      let text = '';

      if (fileType === 'txt') {
        text = await uploadedFile.text();
      } else if (fileType === 'docx') {
        const arrayBuffer = await uploadedFile.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else if (fileType === 'pdf') {
        const arrayBuffer = await uploadedFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          fullText += pageText + '\n';
        }
        text = fullText;
      }

      setContent(text);
    } catch (error) {
      console.error('Error parsing file:', error);
      alert('Erro ao ler o arquivo. Tente outro formato.');
    } finally {
      setIsParsing(false);
    }
  };

  // AI Generation logic
  const generateExam = async () => {
    if (!content) {
      alert('Por favor, envie um material primeiro.');
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is missing');
      alert('Erro de configuração: Chave de API não encontrada. No seu painel de hospedagem, você deve configurar a variável GEMINI_API_KEY antes de gerar o site (Build).');
      return;
    }

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview";

      console.log('Generating exam with model:', model);

      const prompt = `
        Você é um especialista em elaboração de questões do ENEM.
        Com base no seguinte conteúdo:
        ---
        ${content.substring(0, 20000)}
        ---
        Gere ${numQuestions} questões inéditas no estilo ENEM.
        Cada questão deve ter:
        1. Um texto de apoio ou contextualização (pode ser um trecho, uma situação-problema ou um dado).
        2. Um enunciado que exija interpretação e raciocínio crítico.
        3. Exatamente ${numAlternatives} alternativas.
        4. Apenas uma alternativa correta.

        Retorne o resultado estritamente no formato JSON seguindo este esquema:
        {
          "questions": [
            {
              "supportText": "texto de apoio aqui",
              "questionText": "enunciado da questão aqui",
              "alternatives": ["alt 1", "alt 2", ...],
              "correctAnswer": 0
            }
          ]
        }
      `;

      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    supportText: { type: Type.STRING },
                    questionText: { type: Type.STRING },
                    alternatives: { 
                      type: Type.ARRAY, 
                      items: { type: Type.STRING } 
                    },
                    correctAnswer: { type: Type.INTEGER }
                  },
                  required: ["supportText", "questionText", "alternatives", "correctAnswer"]
                }
              }
            },
            required: ["questions"]
          }
        }
      });

      if (!response.text) {
        throw new Error('Resposta vazia da IA');
      }

      const data = JSON.parse(response.text);
      if (!data.questions || !Array.isArray(data.questions)) {
        throw new Error('Estrutura JSON inválida recebida da IA');
      }

      const formattedQuestions = data.questions.map((q: any) => ({
        ...q,
        id: Math.random().toString(36).substr(2, 9)
      }));

      setExamData({
        title: examTitle,
        subject: examSubject,
        date: examDate,
        questions: formattedQuestions
      });
      console.log('Exam generated successfully');
    } catch (error) {
      console.error('Error generating exam:', error);
      alert(`Erro ao gerar a prova: ${error instanceof Error ? error.message : 'Erro desconhecido'}. Tente novamente.`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Pagination logic
  useEffect(() => {
    if (!examData) return;
    
    const measureAndPaginate = () => {
      const MM_TO_PX = 3.78; 
      const PAGE_HEIGHT_MM = 297;
      const MARGIN_MM = 15;
      const HEADER_HEIGHT_MM = 35; 
      
      const availHeightFirstPx = (PAGE_HEIGHT_MM - (MARGIN_MM * 2) - HEADER_HEIGHT_MM) * MM_TO_PX;
      const availHeightOtherPx = (PAGE_HEIGHT_MM - (MARGIN_MM * 2)) * MM_TO_PX;
      const gapPx = 8 * MM_TO_PX; 

      const newPages: PageData[] = [];
      let currentPage: PageData = { leftCol: [], rightCol: [] };
      let leftH = 0;
      let rightH = 0;
      let isFirstPage = true;

      examData.questions.forEach(q => {
        const el = document.getElementById(`measure-${q.id}`);
        if (!el) return;
        
        const h = el.getBoundingClientRect().height + gapPx;
        const maxH = isFirstPage ? availHeightFirstPx : availHeightOtherPx;

        if (leftH + h <= maxH) {
          currentPage.leftCol.push(q);
          leftH += h;
        } else if (rightH + h <= maxH) {
          currentPage.rightCol.push(q);
          rightH += h;
        } else {
          newPages.push(currentPage);
          currentPage = { leftCol: [q], rightCol: [] };
          leftH = h;
          rightH = 0;
          isFirstPage = false;
        }
      });
      
      if (currentPage.leftCol.length > 0 || currentPage.rightCol.length > 0) {
        newPages.push(currentPage);
      }
      
      setPaginatedPages(newPages);
    };

    const timer = setTimeout(measureAndPaginate, 100);
    return () => clearTimeout(timer);
  }, [examData]);

  // PDF Export logic
  const exportToPDF = async () => {
    if (!previewRef.current) {
      alert('Área de visualização não encontrada.');
      return;
    }

    setIsExporting(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pages = previewRef.current.querySelectorAll('.exam-page');
      
      if (pages.length === 0) {
        throw new Error('Nenhuma página para exportar.');
      }
      
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i] as HTMLElement;
        
        const imgData = await toJpeg(page, {
          quality: 0.95,
          backgroundColor: '#ffffff',
          pixelRatio: 2,
        });
        
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      }
      
      pdf.save(`${examTitle.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Erro ao gerar o PDF. Verifique o console para mais detalhes.');
    } finally {
      setIsExporting(false);
    }
  };

  // Question rendering helper
  const renderQuestion = (q: Question, num: number) => (
    <div key={q.id} className="text-[11pt] leading-relaxed text-[#1c1917]">
      <h4 className="font-black mb-2 uppercase text-xs tracking-widest border-b border-[#e7e5e4] pb-1">
        Questão {num}
      </h4>
      {q.supportText && (
        <div className="bg-[#fafaf9] p-3 border-l-2 border-[#d6d3d1] mb-3 text-[10pt] italic text-[#44403c]">
          {q.supportText}
        </div>
      )}
      <p className="font-bold mb-4">{q.questionText}</p>
      <div className="space-y-3">
        {q.alternatives.map((alt, aIdx) => (
          <div key={aIdx} className="flex gap-3 items-start group">
            <div className="w-6 h-6 bg-[#1c1917] text-[#ffffff] rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
              {String.fromCharCode(65 + aIdx)}
            </div>
            <p className="text-sm">{alt}</p>
          </div>
        ))}
      </div>
    </div>
  );

  // Question editing
  const updateQuestion = (id: string, field: keyof Question, value: any) => {
    if (!examData) return;
    setExamData({
      ...examData,
      questions: examData.questions.map(q => q.id === id ? { ...q, [field]: value } : q)
    });
  };

  const deleteQuestion = (id: string) => {
    if (!examData) return;
    setExamData({
      ...examData,
      questions: examData.questions.filter(q => q.id !== id)
    });
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 font-sans selection:bg-emerald-200">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <FileText size={24} />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">Gerador de Provas ENEM</h1>
              <p className="text-xs text-stone-500 font-medium uppercase tracking-wider">Centro Educacional Desafio</p>
            </div>
          </div>
          
          {examData && (
            <div className="flex items-center gap-2">
              <button 
                onClick={handleShare}
                className="relative p-2 text-stone-600 hover:bg-stone-100 rounded-full transition-colors"
                title="Compartilhar Link do App"
              >
                <Share2 size={20} />
                <AnimatePresence>
                  {showShareTooltip && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute top-full mt-2 right-0 bg-stone-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-[60]"
                    >
                      Link copiado!
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
              <button 
                onClick={saveToLocal}
                className="p-2 text-stone-600 hover:bg-stone-100 rounded-full transition-colors"
                title="Salvar Dados (JSON)"
              >
                <Copy size={20} />
              </button>
              <button 
                onClick={() => setExamData(null)}
                className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-full transition-colors"
              >
                Novo Conjunto
              </button>
              <button 
                onClick={exportToPDF}
                disabled={isExporting}
                className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2 rounded-full text-sm font-bold hover:bg-emerald-700 transition-all shadow-sm active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isExporting ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                {isExporting ? 'GERANDO PDF...' : 'BAIXAR PDF'}
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {!examData ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Config Sidebar */}
            <div className="lg:col-span-4 space-y-6">
              <section className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200">
                <div className="flex items-center gap-2 mb-6">
                  <Settings className="text-emerald-600" size={20} />
                  <h2 className="font-bold text-stone-800">Configurações</h2>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">Nome da Prova</label>
                    <input 
                      type="text" 
                      value={examTitle}
                      onChange={(e) => setExamTitle(e.target.value)}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                      placeholder="Ex: Simulado 1º Bimestre"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">Disciplina</label>
                    <input 
                      type="text" 
                      value={examSubject}
                      onChange={(e) => setExamSubject(e.target.value)}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                      placeholder="Ex: História Geral"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">Questões</label>
                      <select 
                        value={numQuestions}
                        onChange={(e) => setNumQuestions(Number(e.target.value))}
                        className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl outline-none"
                      >
                        {[10, 20, 30, 40, 50, 100].map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5">Alternativas</label>
                      <select 
                        value={numAlternatives}
                        onChange={(e) => setNumAlternatives(Number(e.target.value))}
                        className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl outline-none"
                      >
                        {[3, 4, 5].map(n => (
                          <option key={n} value={n}>{n} opções</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              <section className="bg-emerald-50 rounded-2xl p-6 border border-emerald-100">
                <h3 className="font-bold text-emerald-900 mb-2">Dica do Especialista</h3>
                <p className="text-sm text-emerald-800 leading-relaxed">
                  Para melhores resultados, envie materiais que contenham textos base, gráficos ou tabelas. A IA irá extrair o contexto e criar questões interpretativas.
                </p>
              </section>
            </div>

            {/* Upload & Action */}
            <div className="lg:col-span-8 space-y-6">
              <div 
                className={cn(
                  "relative border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center transition-all",
                  file ? "border-emerald-500 bg-emerald-50/30" : "border-stone-300 bg-white hover:border-emerald-400"
                )}
              >
                <input 
                  type="file" 
                  accept=".pdf,.docx,.txt"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                
                {isParsing ? (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="animate-spin text-emerald-600" size={48} />
                    <p className="font-medium text-stone-600">Processando material...</p>
                  </div>
                ) : file ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center">
                      <CheckCircle2 size={32} />
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-stone-800">{file.name}</p>
                      <p className="text-sm text-stone-500">Material carregado com sucesso</p>
                    </div>
                    <button 
                      onClick={() => { setFile(null); setContent(''); }}
                      className="text-xs font-bold text-red-500 uppercase tracking-widest hover:underline"
                    >
                      Remover arquivo
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-stone-100 text-stone-400 rounded-2xl flex items-center justify-center">
                      <Upload size={32} />
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-stone-800">Apostila ou material da matéria</p>
                      <p className="text-sm text-stone-500">Arraste ou clique para enviar (PDF, DOCX, TXT)</p>
                    </div>
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <div className="h-px w-24 bg-stone-200" />
                      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Ou continue de onde parou</p>
                      <label className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-full text-xs font-bold text-stone-600 hover:bg-stone-50 cursor-pointer transition-all shadow-sm">
                        <Upload size={14} />
                        CARREGAR PROVA SALVA (.JSON)
                        <input type="file" accept=".json" onChange={loadFromLocal} className="hidden" />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <button 
                onClick={generateExam}
                disabled={!file || isGenerating || isParsing}
                className={cn(
                  "w-full py-6 rounded-3xl font-black text-xl tracking-tighter flex items-center justify-center gap-3 transition-all active:scale-[0.98]",
                  !file || isGenerating || isParsing
                    ? "bg-stone-200 text-stone-400 cursor-not-allowed"
                    : "bg-emerald-600 text-white shadow-xl shadow-emerald-200 hover:bg-emerald-700 hover:-translate-y-1"
                )}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="animate-spin" size={28} />
                    GERANDO PROVA...
                  </>
                ) : (
                  <>
                    <Play fill="currentColor" size={24} />
                    GERAR PROVA
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Editor Sidebar */}
            <div className="lg:col-span-5 space-y-6 no-print">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-bold text-stone-800">Editar Questões</h2>
                  <span className="bg-stone-100 text-stone-600 px-3 py-1 rounded-full text-xs font-bold">
                    {examData.questions.length} Questões
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={showGabarito}
                        onChange={(e) => setShowGabarito(e.target.checked)}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <span className="text-xs font-bold text-stone-500 uppercase">Incluir Gabarito</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto pr-2 custom-scrollbar">
                  {examData.questions.map((q, idx) => (
                    <motion.div 
                      key={q.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={cn(
                        "p-4 rounded-xl border transition-all cursor-pointer",
                        editingQuestionId === q.id ? "border-emerald-500 bg-emerald-50" : "border-stone-100 bg-stone-50 hover:border-stone-300"
                      )}
                      onClick={() => setEditingQuestionId(editingQuestionId === q.id ? null : q.id)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-sm">Questão {idx + 1}</span>
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); deleteQuestion(q.id); }}
                            className="p-1.5 text-stone-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-stone-600 line-clamp-2 italic mb-1">"{q.supportText}"</p>
                      <p className="text-sm font-medium line-clamp-2">{q.questionText}</p>
                      
                      <AnimatePresence>
                        {editingQuestionId === q.id && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden pt-4 space-y-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div>
                              <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">Texto de Apoio</label>
                              <textarea 
                                value={q.supportText}
                                onChange={(e) => updateQuestion(q.id, 'supportText', e.target.value)}
                                className="w-full p-3 text-sm bg-white border border-stone-200 rounded-lg h-24 outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">Enunciado</label>
                              <textarea 
                                value={q.questionText}
                                onChange={(e) => updateQuestion(q.id, 'questionText', e.target.value)}
                                className="w-full p-3 text-sm bg-white border border-stone-200 rounded-lg h-20 outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">Alternativas</label>
                              {q.alternatives.map((alt, aIdx) => (
                                <div key={aIdx} className="flex gap-2 items-center">
                                  <span className="w-6 h-6 bg-stone-900 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">
                                    {String.fromCharCode(65 + aIdx)}
                                  </span>
                                  <input 
                                    type="text"
                                    value={alt}
                                    onChange={(e) => {
                                      const newAlts = [...q.alternatives];
                                      newAlts[aIdx] = e.target.value;
                                      updateQuestion(q.id, 'alternatives', newAlts);
                                    }}
                                    className="flex-1 p-2 text-sm bg-white border border-stone-200 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
                                  />
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            {/* Preview Area */}
            <div className="lg:col-span-7">
              <div className="bg-stone-300 p-8 rounded-2xl shadow-inner overflow-x-auto">
                <div ref={previewRef} className="flex flex-col gap-8 items-center">
                  {paginatedPages.map((page, pageIdx) => (
                    <div key={pageIdx} className="shadow-2xl">
                      <div 
                        className="exam-page bg-[#ffffff] relative"
                        style={{ 
                          width: '210mm', 
                          height: '297mm', 
                          padding: '15mm',
                          boxSizing: 'border-box',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Page Header */}
                        {pageIdx === 0 && (
                          <div className="border-b-2 border-[#1c1917] pb-4 mb-6 flex justify-between items-end" style={{ height: '25mm' }}>
                            <div>
                              <h3 className="text-xl font-black tracking-tighter text-[#1c1917]">CENTRO EDUCACIONAL DESAFIO</h3>
                              <p className="text-sm font-bold text-[#57534e]">{examData.title} | {examData.subject}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-bold text-[#78716c] uppercase">Data: {examData.date}</p>
                            </div>
                          </div>
                        )}

                        {/* Two Column Layout */}
                        <div className="flex justify-between" style={{ height: pageIdx === 0 ? 'calc(100% - 31mm)' : '100%' }}>
                          <div style={{ width: '85mm' }} className="flex flex-col gap-[8mm]">
                            {page.leftCol.map(q => renderQuestion(q, examData.questions.findIndex(x => x.id === q.id) + 1))}
                          </div>
                          <div style={{ width: '85mm' }} className="flex flex-col gap-[8mm]">
                            {page.rightCol.map(q => renderQuestion(q, examData.questions.findIndex(x => x.id === q.id) + 1))}
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="absolute bottom-4 left-[15mm] right-[15mm] border-t border-[#e7e5e4] pt-2 flex justify-between items-center opacity-30 text-[#1c1917]">
                          <span className="text-[8pt] font-bold">ENEM SIMULATOR PRO</span>
                          <span className="text-[8pt] font-bold">Página {pageIdx + 1} de {paginatedPages.length}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Gabarito Page */}
                  {showGabarito && (
                    <div className="shadow-2xl">
                      <div 
                        className="exam-page bg-[#ffffff] relative"
                        style={{ 
                          width: '210mm', 
                          height: '297mm', 
                          padding: '15mm',
                          boxSizing: 'border-box',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Page Header */}
                        <div className="border-b-2 border-[#1c1917] pb-4 mb-6 flex justify-between items-end" style={{ height: '25mm' }}>
                          <div>
                            <h3 className="text-xl font-black tracking-tighter text-[#1c1917]">GABARITO OFICIAL</h3>
                            <p className="text-sm font-bold text-[#57534e]">{examData.title} | {examData.subject}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-[#78716c] uppercase">Data: {examData.date}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-5 gap-x-6 gap-y-4 mt-8">
                          {examData.questions.map((q, idx) => (
                            <div key={q.id} className="flex items-center gap-3 p-2 border-b border-[#e7e5e4]">
                              <span className="font-bold text-[#1c1917] w-6 text-right">{idx + 1}.</span>
                              <div className="w-8 h-8 bg-[#1c1917] text-[#ffffff] rounded-full flex items-center justify-center text-sm font-bold">
                                {String.fromCharCode(65 + q.correctAnswer)}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Footer */}
                        <div className="absolute bottom-4 left-[15mm] right-[15mm] border-t border-[#e7e5e4] pt-2 flex justify-between items-center opacity-30 text-[#1c1917]">
                          <span className="text-[8pt] font-bold">ENEM SIMULATOR PRO</span>
                          <span className="text-[8pt] font-bold">Gabarito</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Hidden Measurement Container for Pagination */}
        {examData && (
          <div 
            className="absolute opacity-0 pointer-events-none z-[-100]" 
            style={{ width: '85mm', left: '-9999px', top: 0 }}
          >
            {examData.questions.map((q, qIdx) => (
              <div key={`measure-${q.id}`} id={`measure-${q.id}`} className="text-[11pt] leading-relaxed text-[#1c1917]">
                <h4 className="font-black mb-2 uppercase text-xs tracking-widest border-b border-[#e7e5e4] pb-1">
                  Questão {qIdx + 1}
                </h4>
                {q.supportText && (
                  <div className="bg-[#fafaf9] p-3 border-l-2 border-[#d6d3d1] mb-3 text-[10pt] italic text-[#44403c]">
                    {q.supportText}
                  </div>
                )}
                <p className="font-bold mb-4">{q.questionText}</p>
                <div className="space-y-3">
                  {q.alternatives.map((alt, aIdx) => (
                    <div key={aIdx} className="flex gap-3 items-start group">
                      <div className="w-6 h-6 bg-[#1c1917] text-[#ffffff] rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                        {String.fromCharCode(65 + aIdx)}
                      </div>
                      <p className="text-sm">{alt}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
        
        @media print {
          @page {
            size: A4;
            margin: 1.5cm;
          }
          body {
            background: white;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* Hide UI elements */
          header, .no-print {
            display: none !important;
          }
          /* Reset container styles for printing */
          main {
            padding: 0 !important;
            max-width: none !important;
            margin: 0 !important;
          }
          #printable-exam {
            width: 100% !important;
            max-width: none !important;
            min-height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }
          .break-inside-avoid {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            -webkit-column-break-inside: avoid !important;
          }
        }
      `}</style>
    </div>
  );
}
