"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  allowCustomValue?: boolean
  className?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "選択...",
  searchPlaceholder = "検索...",
  emptyText = "見つかりません",
  allowCustomValue = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState("")

  const selectedLabel = React.useMemo(() => {
    const found = options.find((option) => option.value === value)
    return found?.label ?? (value || placeholder)
  }, [options, value, placeholder])

  const handleSelect = (currentValue: string) => {
    onValueChange(currentValue === value ? "" : currentValue)
    setOpen(false)
    setInputValue("")
  }

  const handleInputChange = (search: string) => {
    setInputValue(search)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (allowCustomValue && e.key === "Enter" && inputValue) {
      const exists = options.some(
        (option) => option.value.toLowerCase() === inputValue.toLowerCase()
      )
      if (!exists) {
        onValueChange(inputValue)
        setOpen(false)
        setInputValue("")
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn(!value && "text-muted-foreground")}>
            {selectedLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={inputValue}
            onValueChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          <CommandList>
            <CommandEmpty>
              {allowCustomValue && inputValue ? (
                <button
                  type="button"
                  className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded-sm"
                  onClick={() => {
                    onValueChange(inputValue)
                    setOpen(false)
                    setInputValue("")
                  }}
                >
                  「{inputValue}」を使用
                </button>
              ) : (
                emptyText
              )}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={handleSelect}
                >
                  {option.label}
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
