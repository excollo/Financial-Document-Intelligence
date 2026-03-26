import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      closeButton={true}
      position="bottom-right"
      duration={10000}
      expand={true}
      richColors={true}
      toastOptions={{
        duration: 10000,
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg relative",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "!absolute !top-0 !right-0 !opacity-100 hover:!opacity-80 !transition-opacity !cursor-pointer !z-50 !rounded-full !w-5 !h-5 !flex !items-center !justify-center !m-0 !p-0",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
