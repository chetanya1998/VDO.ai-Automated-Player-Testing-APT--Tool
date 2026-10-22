const VARIANT_CLASSES = { primary: 'btn-primary', danger: 'btn-danger' };

export default function Button({ variant = 'default', size, type = 'button', className = '', ...props }) {
  const classes = ['btn', VARIANT_CLASSES[variant], size === 'small' && 'btn-small', className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}
