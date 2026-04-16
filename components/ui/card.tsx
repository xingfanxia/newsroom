import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { featured?: boolean }
>(({ className, featured, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      featured ? "surface-featured" : "surface-card",
      "transition-colors",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-5 pb-3", className)} {...props} />
);

export const CardBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-5 pt-0", className)} {...props} />
);

export const CardTitle = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn(
      "text-[20px] font-[590] text-[var(--color-fg)] tracking-[-0.24px] leading-snug",
      className,
    )}
    {...props}
  />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p
    className={cn(
      "text-[15px] text-[var(--color-fg-muted)] leading-relaxed",
      className,
    )}
    {...props}
  />
);
