import { coverImageAttrs } from '../lib/coverImage'

type Props = {
  src: string
  className?: string
  alt?: string
  columnLayout?: 'full' | 'third'
}

export default function CoverImage({ src, className, alt = '', columnLayout = 'third' }: Props) {
  const attrs = coverImageAttrs(src, columnLayout)
  if (!attrs) return null
  return <img className={className} alt={alt} {...attrs} />
}
