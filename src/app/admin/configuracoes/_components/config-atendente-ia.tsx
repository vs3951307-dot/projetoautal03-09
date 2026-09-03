"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bot, RotateCcw, Save, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, useApi } from "@/lib/api-cliente";

const TOMS = {
  simpatico: "Simpático",
  profissional: "Profissional",
  descontraido: "Descontraído",
  formal: "Formal",
} as const;

const NICHOS = {
  pizzaria: "Pizzaria / Delivery de pizza",
  hamburgueria: "Hamburgueria / Lanches",
  restaurante: "Restaurante / Comida",
  farmacia: "Farmácia / Drogaria",
  petshop: "Pet Shop",
  moda: "Loja de roupas / Moda",
  mercado: "Mercado / Conveniência",
  servicos: "Serviços / Agendamentos",
  generico: "Genérico / Outros",
} as const;

type TomAtendente = keyof typeof TOMS;
type NichoAtendente = keyof typeof NICHOS;

interface PersonaAtendente {
  nome: string;
  tom: TomAtendente;
  nicho: NichoAtendente;
  regras: string;
  horario: string;
  saudacaoCustom?: string;
  instrucoesAdicionais?: string;
  iaAtiva?: boolean;
}

const PADRAO: PersonaAtendente = {
  nome: "",
  tom: "simpatico",
  nicho: "generico",
  regras: "",
  horario: "",
  saudacaoCustom: "",
  instrucoesAdicionais: "",
  iaAtiva: true,
};

interface ConfiguracoesApi {
  atendente_ia?: PersonaAtendente;
  [chave: string]: unknown;
}

function previewSaudacao(persona: PersonaAtendente): string {
  if (persona.saudacaoCustom?.trim()) return persona.saudacaoCustom.trim();
  const nome = persona.nome.trim();
  const emoji =
    persona.nicho === "pizzaria"
      ? "🍕"
      : persona.nicho === "hamburgueria"
        ? "🍔"
        : persona.nicho === "farmacia"
          ? "💊"
          : persona.nicho === "petshop"
            ? "🐾"
            : persona.nicho === "moda"
              ? "👗"
              : "😊";
  if (!nome) return `Olá! ${emoji} O que você deseja hoje?`;
  return `Olá! Eu sou ${nome}, atendente da nossa loja! ${emoji} Como posso ajudar você hoje?`;
}

/** Atendente IA — configuração por empresa (multi-tenant / multi-nicho). */
export function ConfigAtendenteIa() {
  const { dados, recarregar } = useApi<ConfiguracoesApi>("/api/configuracoes", {
    atendente_ia: PADRAO,
  });

  const [formulario, setFormulario] = React.useState<PersonaAtendente>(PADRAO);
  const [carregou, setCarregou] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  React.useEffect(() => {
    if (!carregou && dados?.atendente_ia) {
      setFormulario({
        ...PADRAO,
        ...dados.atendente_ia,
        nicho: (dados.atendente_ia.nicho as NichoAtendente) || "generico",
        iaAtiva: dados.atendente_ia.iaAtiva !== false,
      });
      setCarregou(true);
    }
  }, [dados, carregou]);

  function campo<K extends keyof PersonaAtendente>(chave: K) {
    return (valor: PersonaAtendente[K]) => setFormulario((f) => ({ ...f, [chave]: valor }));
  }

  const salvar = async () => {
    setSalvando(true);
    try {
      await api("/api/configuracoes", {
        method: "PUT",
        body: JSON.stringify({ chave: "atendente_ia", valor: formulario }),
      });
      toast.success("Atendente IA salvo.");
      await recarregar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao salvar o atendente");
    } finally {
      setSalvando(false);
    }
  };

  const restaurar = () => {
    setFormulario(PADRAO);
    toast.success("Campos restaurados — clique em Salvar para aplicar.");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-status-waiting-border bg-status-waiting-bg p-4 text-sm text-status-waiting">
        <p>
          <strong>Quem atende no WhatsApp?</strong> Defina nome, nicho, tom e regras da atendente
          virtual desta empresa. Chaves de API da IA ficam apenas no servidor (.env), nunca neste
          painel.
        </p>
      </div>

      <Card>
        <CardHeader className="p-6 pb-2 sm:p-7 sm:pb-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
            Identidade da atendente
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 p-6 pt-4 sm:grid-cols-2 sm:p-7 sm:pt-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label className="text-sm font-medium text-muted-foreground">
              Nome da atendente (ex.: Ana)
            </Label>
            <Input
              value={formulario.nome}
              onChange={(e) => campo("nome")(e.target.value)}
              placeholder="Ex.: Ana"
              maxLength={80}
              aria-label="Nome da atendente"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-muted-foreground">Tom de voz</Label>
            <Select value={formulario.tom} onValueChange={(v) => campo("tom")(v as TomAtendente)}>
              <SelectTrigger aria-label="Tom de voz">
                <SelectValue placeholder="Escolha o tom" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TOMS).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-muted-foreground">Nicho do negócio</Label>
            <Select
              value={formulario.nicho || "generico"}
              onValueChange={(v) => campo("nicho")(v as NichoAtendente)}
            >
              <SelectTrigger aria-label="Nicho do negócio">
                <SelectValue placeholder="Escolha o nicho" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(NICHOS).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>
                    {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label className="text-sm font-medium text-muted-foreground">
              Saudação personalizada (opcional)
            </Label>
            <Textarea
              value={formulario.saudacaoCustom || ""}
              onChange={(e) => campo("saudacaoCustom")(e.target.value)}
              placeholder="Deixe vazio para usar a automática. Pode usar {{nome}} e {{loja}}."
              rows={2}
            />
          </div>

          <div className="rounded-xl border bg-muted/30 p-3 text-sm sm:col-span-2">
            <p className="mb-1 font-medium">Prévia da saudação</p>
            <p>{previewSaudacao(formulario)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-6 pb-2 sm:p-7 sm:pb-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            Regras e horário
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Como a empresa funciona — a atendente usa isso para responder pedido mínimo, formas de
            pagamento, entrega e horário.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 p-6 pt-4 sm:p-7 sm:pt-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-muted-foreground">Horário falado</Label>
            <Input
              value={formulario.horario}
              onChange={(e) => campo("horario")(e.target.value)}
              placeholder="Ex.: Seg a Dom, 18h às 23h"
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-muted-foreground">Regras da loja</Label>
            <Textarea
              value={formulario.regras}
              onChange={(e) => campo("regras")(e.target.value)}
              placeholder="Ex.: Pedido mínimo R$ 30. Não entregamos em zona rural. Aceitamos Pix e cartão."
              rows={4}
              maxLength={4000}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-muted-foreground">
              Instruções adicionais (tom/comportamento)
            </Label>
            <Textarea
              value={formulario.instrucoesAdicionais || ""}
              onChange={(e) => campo("instrucoesAdicionais")(e.target.value)}
              placeholder="Ex.: Sempre ofereça bebida. Seja breve."
              rows={3}
              maxLength={2000}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button onClick={salvar} disabled={salvando} className="gap-2">
          <Save className="h-4 w-4" />
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
        <Button type="button" variant="outline" onClick={restaurar} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Restaurar padrão
        </Button>
      </div>
    </div>
  );
}
