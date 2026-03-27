import React, { useState } from 'react';
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { countries } from '@/constants/countries';

interface CountryPickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const CountryPicker: React.FC<CountryPickerProps> = ({ value, onChange, className }) => {
  const [open, setOpen] = useState(false);
  const selectedCountry = countries.find((country) => country.code === value) || countries.find(c => c.code === '+58');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-[110px] justify-between h-14 bg-zinc-900/50 border-zinc-800 text-white rounded-2xl hover:bg-zinc-800/80 hover:border-zinc-700 transition-all active:scale-95",
            className
          )}
        >
          <span className="flex items-center gap-2">
            <span className="text-xl leading-none">{selectedCountry?.flag}</span>
            <span className="font-bold text-sm">{selectedCountry?.code}</span>
          </span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50 text-zinc-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0 bg-zinc-950 border-zinc-900 shadow-[0_10px_40px_rgba(0,0,0,0.8)] rounded-2xl overflow-hidden backdrop-blur-xl">
        <Command className="bg-transparent">
          <div className="flex items-center border-b border-zinc-900 px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 text-yellow-500/50" />
            <CommandInput 
              placeholder="Buscar país..." 
              className="h-12 bg-transparent text-white border-none focus:ring-0 placeholder:text-zinc-600"
            />
          </div>
          <CommandList className="max-h-[300px] scrollbar-thin scrollbar-thumb-zinc-800">
            <CommandEmpty className="py-6 text-center text-sm text-zinc-600">No se encontró el país.</CommandEmpty>
            <CommandGroup>
              {countries.map((country) => (
                <CommandItem
                  key={country.name + country.code}
                  value={country.name}
                  onSelect={() => {
                    onChange(country.code);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-yellow-500/10 aria-selected:bg-yellow-500/10 text-zinc-400 aria-selected:text-white transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl leading-none">{country.flag}</span>
                    <span className="text-sm font-medium">{country.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-zinc-500">{country.code}</span>
                    <Check
                      className={cn(
                        "h-4 w-4 text-yellow-500",
                        value === country.code ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
